import { z } from "zod";
import {
  AppError,
  assert,
  id,
  jobStatus,
  Member,
  Permissions,
  Receipt,
  text,
} from "../contracts";
import { Identity } from "../contracts";
import { Service } from "../service";
import { CRM, crmTools } from "../crm";

// Channel-independent catalog. New adapters implement business capabilities below
// this boundary; SDK tools never receive database clients or arbitrary HTTP access.
export type ToolDefinition = {
  name: string;
  description: string;
  permission: keyof Permissions | "owner";
  risk: "READ" | "ROUTINE" | "SENSITIVE";
  parameters: z.ZodObject<any>;
  operation?: string;
};
export const toolCatalog: readonly ToolDefinition[] = [
  ...crmTools,
  {
    name: "actions_recent",
    permission: "job.read",
    risk: "READ",
    description:
      "Read your latest accessible action receipts, including the current outcome of owner approvals. Returns at most 20 recent receipts; absence is not proof that an older action did not happen.",
    parameters: z.object({}).strict(),
  },
  {
    name: "jobs_search",
    permission: "job.read",
    risk: "READ",
    description:
      "Find accessible demo CRM jobs by customer, property address or job title. Use null for no filter. Returns at most 20 matches; narrow the search if truncated. Dates are YYYY-MM-DD. Resolve ambiguity before a write.",
    parameters: z
      .object({ query: text(160).nullable(), date: z.iso.date().nullable() })
      .strict(),
  },
  {
    name: "job_get",
    permission: "job.read",
    risk: "READ",
    description:
      "Read an accessible job and its customer and property details from the demo CRM.",
    parameters: z.object({ jobId: id }).strict(),
  },
  {
    name: "notes_list",
    permission: "business_note.list",
    risk: "READ",
    description:
      "Read the latest 20 service notes allowed by your current permissions for a job.",
    parameters: z.object({ jobId: id }).strict(),
  },
  {
    name: "note_add",
    permission: "business_note.create",
    risk: "ROUTINE",
    operation: "business_note.create",
    description:
      "Save a native GhostAI service note on a resolved job. Preserve the user's meaning. Does not update an external CRM.",
    parameters: z.object({ jobId: id, text: text() }).strict(),
  },
  {
    name: "job_status_set",
    permission: "job.update",
    risk: "ROUTINE",
    operation: "job.update",
    description:
      "Set a resolved job's status in the demo CRM only. Does not change an external provider.",
    parameters: z.object({ jobId: id, status: jobStatus }).strict(),
  },
  {
    name: "repair_request",
    permission: "service_request.create",
    risk: "SENSITIVE",
    operation: "service_request.create",
    description:
      "Propose a repair for a resolved demo CRM job. Always waits for an owner to approve in the portal. Never describe a pending proposal as a created repair.",
    parameters: z.object({ jobId: id, text: text() }).strict(),
  },
];
export function availableTools(member: Member): ToolDefinition[] {
  return toolCatalog.filter(
    (t) =>
      member.role === "owner" ||
      (t.permission !== "owner" && Boolean(member.permissions[t.permission])),
  );
}
export type ToolContext = {
  identity: Identity;
  tenant: string;
  conversationId: string;
  // Server-derived and persisted before execution, never supplied by the model.
  executionKey: string;
};
export interface BusinessTools {
  read(
    context: ToolContext,
    name: string,
    args: Record<string, any>,
  ): Promise<unknown>;
  write(
    context: ToolContext,
    definition: ToolDefinition,
    args: Record<string, any>,
  ): Promise<Receipt>;
}
export class DemoBusinessTools implements BusinessTools {
  private crm: CRM;
  constructor(private service: Service) {
    this.crm = new CRM(service);
  }
  async read(context: ToolContext, name: string, args: Record<string, any>) {
    const { identity, tenant } = context;
    if (name === "crm_search" || name === "crm_get")
      return this.crm.read(identity, tenant, name, args);
    const state = await this.service.state(identity, tenant);
    if (name === "actions_recent") {
      return {
        receipts: state.receipts.filter((r) => r.actorId === identity.uid),
        limited: true,
      };
    }
    const enrich = (job: any) => {
      const property = state.properties.find((p) => p.id === job.propertyId);
      const customer = state.customers.find(
        (c) => c.id === property?.customerId,
      );
      return {
        id: job.id,
        title: job.title,
        date: job.date,
        status: job.status,
        revision: job.revision ?? 0,
        property: property
          ? {
              id: property.id,
              label: property.label,
              address: property.address,
            }
          : null,
        customer: customer ? { id: customer.id, name: customer.name } : null,
        provider: "demo_crm",
      };
    };
    if (name === "jobs_search") {
      const query = (args.query ?? "").toLowerCase();
      const jobs = state.jobs
        .map(enrich)
        .filter(
          (j) =>
            (!args.date || j.date === args.date) &&
            (!query || JSON.stringify(j).toLowerCase().includes(query)),
        );
      return {
        jobs: jobs.slice(0, 20),
        truncated: jobs.length > 20 || state.jobs.length >= 500,
      };
    }
    if (name === "job_get") {
      const job = state.jobs.find((j) => j.id === args.jobId);
      assert(job, "Job not found or not available to you.", 404);
      return enrich(job);
    }
    if (name === "notes_list") {
      // Notes can have a distinct scope from job.read. Authorize the operation itself.
      await this.service.db.runTransaction(async (tx) => {
        const member = await this.service.membership(tx, tenant, identity.uid);
        await this.service.authorizeJob(
          tx,
          tenant,
          member,
          "business_note.list",
          args.jobId,
        );
      });
      const notes = state.notes
        .filter((n) => n.jobId === args.jobId)
        .sort((a, b) => b.createdAt - a.createdAt);
      return {
        notes: notes.slice(0, 20).map((n) => ({
          id: n.id,
          text: n.text,
          authorName: n.authorName,
          createdAt: n.createdAt,
          revision: n.revision ?? 0,
        })),
        truncated: notes.length > 20,
        provider: "native",
      };
    }
    throw new AppError(400, "Unknown business tool.");
  }
  write(
    context: ToolContext,
    definition: ToolDefinition,
    args: Record<string, any>,
  ) {
    assert(definition.operation, "This tool cannot write.", 400);
    if (definition.operation.startsWith("crm."))
      return this.crm.write(
        context.identity,
        context.tenant,
        definition.name,
        args,
        context.executionKey,
        context.conversationId,
      );
    return this.service.submit(context.identity, context.tenant, {
      key: context.executionKey,
      conversationId: context.conversationId,
      proposal: { operation: definition.operation, arguments: args },
    });
  }
}

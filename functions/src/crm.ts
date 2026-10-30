import { createHash } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { z } from "zod";
import { assert, id, Identity, jobStatus, Receipt, text } from "./contracts";
import { Service } from "./service";

const resource = z.enum([
  "customers",
  "properties",
  "jobs",
  "notes",
  "repairs",
]);
type Resource = z.infer<typeof resource>;
type Data = Record<string, any>;
const revision = z.number().int().min(0);
const email = z.union([z.email(), z.literal("")]);
const phone = z.string().trim().max(40);
const ownerTool = (
  name: string,
  description: string,
  parameters: z.ZodObject<any>,
  write = true,
) => ({
  name,
  description,
  parameters,
  permission: "owner" as const,
  risk: write ? ("ROUTINE" as const) : ("READ" as const),
  ...(write ? { operation: `crm.${name}` } : {}),
});
export const crmTools = [
  ownerTool(
    "crm_search",
    "Search/list any demo CRM record type, including customers without jobs. query matches name, email, phone, address, title or note text. Use null for no filter. Pages scan 50 records; continue with nextCursor even if no matches. includeArchived exposes recoverable removed records to owners.",
    z
      .object({
        resource,
        query: text(160).nullable(),
        includeArchived: z.boolean(),
        cursor: id.nullable(),
      })
      .strict(),
    false,
  ),
  ownerTool(
    "crm_get",
    "Read an exact demo CRM record including its current revision and archived status. Use IDs from search or prior successful receipts. Read before editing; never invent IDs or revision numbers.",
    z.object({ resource, recordId: id }).strict(),
    false,
  ),
  ownerTool(
    "customer_create",
    "Create a demo CRM customer. Name is required; unknown email and phone should be null. Check for duplicates first. allowDuplicate must be false unless the user explicitly requested another matching customer after being told about the existing match.",
    z
      .object({
        name: text(120),
        email: email.nullable(),
        phone: phone.nullable(),
        allowDuplicate: z.boolean(),
      })
      .strict(),
  ),
  ownerTool(
    "customer_update",
    "Edit a customer using the revision from crm_get. Null means leave a field unchanged; empty email/phone clears it. Only change fields requested by the user.",
    z
      .object({
        recordId: id,
        expectedRevision: revision,
        name: text(120).nullable(),
        email: email.nullable(),
        phone: phone.nullable(),
      })
      .strict(),
  ),
  ownerTool(
    "property_create",
    "Create a property belonging to a resolved customer. Address is required. A null label uses the address. Check existing properties first; allowDuplicate is true only for an explicitly requested duplicate.",
    z
      .object({
        customerId: id,
        address: text(250),
        label: text(120).nullable(),
        allowDuplicate: z.boolean(),
      })
      .strict(),
  ),
  ownerTool(
    "property_update",
    "Edit a property's address, label or customer link using its current revision. Null means unchanged. Only reassign to another customer when explicitly requested.",
    z
      .object({
        recordId: id,
        expectedRevision: revision,
        customerId: id.nullable(),
        address: text(250).nullable(),
        label: text(120).nullable(),
      })
      .strict(),
  ),
  ownerTool(
    "job_create",
    "Schedule a new demo CRM job at a resolved property. Title and date (YYYY-MM-DD) are required; ask when missing or ambiguous. New jobs are scheduled. Check duplicates first; allowDuplicate is true only for an explicitly requested duplicate.",
    z
      .object({
        propertyId: id,
        title: text(160),
        date: z.iso.date(),
        allowDuplicate: z.boolean(),
      })
      .strict(),
  ),
  ownerTool(
    "job_edit",
    "Edit a demo CRM job's title, date, property or status using the current revision. Null means unchanged. Ask before ambiguous scheduling changes; only move property when requested.",
    z
      .object({
        recordId: id,
        expectedRevision: revision,
        propertyId: id.nullable(),
        title: text(160).nullable(),
        date: z.iso.date().nullable(),
        status: jobStatus.nullable(),
      })
      .strict(),
  ),
  ownerTool(
    "note_update",
    "Correct a saved GhostAI note using its current revision. Preserve the requested meaning and do not alter an unrelated note.",
    z
      .object({ recordId: id, expectedRevision: revision, text: text() })
      .strict(),
  ),
  ownerTool(
    "repair_update",
    "Edit the description of an already-created demo CRM repair using its current revision. Pending approval proposals are separate and cannot be edited or approved through this tool.",
    z
      .object({ recordId: id, expectedRevision: revision, text: text() })
      .strict(),
  ),
  ownerTool(
    "repair_resolve",
    "Mark an existing demo CRM repair resolved using its current revision. This does not approve a pending repair proposal.",
    z.object({ recordId: id, expectedRevision: revision }).strict(),
  ),
  ownerTool(
    "record_archive",
    "Remove a record from active CRM views by archiving it, or restore it with archived=false. Requires current revision and explicit user intent. No permanent deletion or cascade: archive active child properties/jobs before a parent customer/property. Job notes/repairs are retained. Restore parents before children.",
    z
      .object({
        resource,
        recordId: id,
        expectedRevision: revision,
        archived: z.boolean(),
      })
      .strict(),
  ),
];
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: Data) =>
  JSON.stringify(
    Object.keys(value)
      .sort()
      .map((k) => [k, value[k]]),
  );
const normalize = (value: string = "") =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const fields: Record<Resource, string[]> = {
  customers: ["name", "email", "phone"],
  properties: ["customerId", "label", "address"],
  jobs: ["propertyId", "title", "date", "status"],
  notes: ["jobId", "text", "authorId", "authorName"],
  repairs: ["jobId", "text", "status", "createdBy", "resolvedAt"],
};
export class CRM {
  constructor(private service: Service) {}
  collection(tenant: string, kind: Resource) {
    return this.service
      .org(tenant)
      .collection(kind === "repairs" ? "requests" : kind);
  }
  publicRecord(kind: Resource, recordId: string, data: Data) {
    return {
      id: recordId,
      resource: kind,
      revision: data.revision ?? 0,
      archived: Boolean(data.archivedAt),
      ...Object.fromEntries(
        [...fields[kind], "createdAt", "updatedAt"]
          .filter((k) => data[k] !== undefined)
          .map((k) => [k, data[k]]),
      ),
    };
  }
  async read(identity: Identity, tenant: string, name: string, input: unknown) {
    const definition = crmTools.find((t) => t.name === name && !t.operation);
    assert(definition, "Unknown CRM read tool.", 400);
    const args = definition.parameters.parse(input) as Data;
    return this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid, true);
      const kind = resource.parse(args.resource),
        collection = this.collection(tenant, kind);
      if (name === "crm_get") {
        const record = await tx.get(collection.doc(args.recordId));
        assert(record.exists, "Record not found in this company.", 404);
        return { record: this.publicRecord(kind, record.id, record.data()!) };
      }
      let query = collection.orderBy(FieldPath.documentId()).limit(50);
      if (args.cursor) query = query.startAfter(args.cursor);
      const page = await tx.get(query),
        needle = normalize(args.query ?? "");
      const records = page.docs
        .filter((d) => args.includeArchived || !d.data().archivedAt)
        .map((d) => this.publicRecord(kind, d.id, d.data()))
        .filter(
          (record) =>
            !needle || normalize(JSON.stringify(record)).includes(needle),
        );
      return {
        records,
        nextCursor: page.size === 50 ? page.docs.at(-1)!.id : null,
        resource: kind,
        provider: kind === "notes" ? "native" : "demo_crm",
      };
    });
  }
  async write(
    identity: Identity,
    tenant: string,
    name: string,
    input: unknown,
    key: string,
    conversationId: string,
  ): Promise<Receipt & { record: Data }> {
    const definition = crmTools.find((t) => t.name === name && t.operation);
    assert(definition, "Unknown CRM write tool.", 400);
    const args = definition.parameters.parse(input) as Data;
    id.parse(conversationId);
    text(128).parse(key);
    const kind: Resource = name.startsWith("customer_")
      ? "customers"
      : name.startsWith("property_")
        ? "properties"
        : name.startsWith("job_")
          ? "jobs"
          : name.startsWith("note_")
            ? "notes"
            : name.startsWith("repair_")
              ? "repairs"
              : resource.parse(args.resource);
    const creating = name.endsWith("_create");
    const requestId = hash(`${identity.uid}:${key}`),
      recordId = creating
        ? hash(`${identity.uid}:${kind}:${key}`).slice(0, 32)
        : args.recordId;
    const target = this.collection(tenant, kind).doc(recordId),
      receiptRef = this.service
        .org(tenant)
        .collection("receipts")
        .doc(requestId);
    const digest = hash(
      canonical({ tenant, actor: identity.uid, name, args, conversationId }),
    );
    return this.service.db.runTransaction(async (tx) => {
      const member = await this.service.membership(
        tx,
        tenant,
        identity.uid,
        true,
      );
      const [existingReceipt, targetDoc] = await Promise.all([
        tx.get(receiptRef),
        tx.get(target),
      ]);
      if (existingReceipt.exists) {
        assert(
          existingReceipt.data()!.digest === digest,
          "This request was used for different details.",
          409,
        );
        // Native receipt and record commit together. Return current record metadata
        // for subsequent edits, never replay an old mutation over a newer version.
        assert(targetDoc.exists, "Saved record is unavailable.", 409);
        return {
          ...this.service.publicReceipt(existingReceipt.data()!),
          record: this.publicRecord(kind, recordId, targetDoc.data()!),
        };
      }
      if (!creating) {
        assert(targetDoc.exists, "Record not found in this company.", 404);
        assert(
          (targetDoc.data()!.revision ?? 0) === args.expectedRevision,
          "This record changed. Read it again before editing.",
          409,
        );
        assert(
          !targetDoc.data()!.archivedAt || name === "record_archive",
          "Restore this archived record before editing it.",
          409,
        );
      } else assert(!targetDoc.exists, "Record already exists.", 409);
      const before = targetDoc.data() ?? {};
      let patch: Data = {};
      if (name === "record_archive")
        patch = { archivedAt: args.archived ? Date.now() : null };
      else if (name === "repair_resolve")
        patch = { status: "resolved", resolvedAt: Date.now() };
      else {
        const editable = fields[kind].filter(
          (k) =>
            !["authorId", "authorName", "createdBy", "resolvedAt"].includes(k),
        );
        patch = Object.fromEntries(
          editable
            .filter((k) => args[k] !== null && args[k] !== undefined)
            .map((k) => [k, args[k]]),
        );
        if (creating && kind === "customers") {
          patch.email ??= "";
          patch.phone ??= "";
        }
        if (creating && kind === "properties")
          patch.label ??= patch.address.slice(0, 120);
        if (creating && kind === "jobs") patch.status = "scheduled";
        assert(
          Object.keys(patch).length > 0,
          "No changed fields were provided.",
          400,
        );
      }
      const after = { ...before, ...patch };
      const active = async (parentKind: Resource, parentId: string) => {
        const snapshot = await tx.get(
          this.collection(tenant, parentKind).doc(parentId),
        );
        assert(
          snapshot.exists && !snapshot.data()!.archivedAt,
          "The linked record is missing or archived. Restore or select an active record first.",
          409,
        );
        return snapshot.data()!;
      };
      if (!(name === "record_archive" && args.archived)) {
        if (kind === "properties") await active("customers", after.customerId);
        if (kind === "jobs") {
          const property = await active("properties", after.propertyId);
          await active("customers", property.customerId);
        }
        if (kind === "notes" || kind === "repairs") {
          const job = await active("jobs", after.jobId);
          const property = await active("properties", job.propertyId);
          await active("customers", property.customerId);
        }
      }
      if (
        name === "record_archive" &&
        args.archived &&
        (kind === "customers" || kind === "properties")
      ) {
        const children = await tx.get(
          this.collection(
            tenant,
            kind === "customers" ? "properties" : "jobs",
          ).where(
            kind === "customers" ? "customerId" : "propertyId",
            "==",
            recordId,
          ),
        );
        assert(
          children.docs.every((d) => d.data().archivedAt),
          "Archive the active child records first. No records were removed.",
          409,
        );
      }
      if (creating && !args.allowDuplicate) {
        // Serialize duplicate checks even for legacy portal records without normalized
        // indexes. The query range is bounded; never silently skip older records.
        const guard = this.service
          .org(tenant)
          .collection("crmGuards")
          .doc(kind);
        const guardDoc = await tx.get(guard);
        const candidates = await tx.get(
          this.collection(tenant, kind).limit(1001),
        );
        assert(
          candidates.size <= 1000,
          "This collection needs indexed duplicate lookup before adding records. Ask the owner for support.",
          409,
        );
        const duplicate = candidates.docs.some((d) => {
          const other = d.data();
          if (kind === "customers")
            return (
              normalize(other.name) === normalize(after.name) ||
              (after.email &&
                normalize(other.email) === normalize(after.email)) ||
              (after.phone &&
                other.phone &&
                other.phone.replace(/\D/g, "") ===
                  after.phone.replace(/\D/g, ""))
            );
          if (kind === "properties")
            return (
              other.customerId === after.customerId &&
              normalize(other.address) === normalize(after.address) &&
              normalize(other.label) === normalize(after.label)
            );
          return (
            other.propertyId === after.propertyId &&
            normalize(other.title) === normalize(after.title) &&
            other.date === after.date
          );
        });
        assert(
          !duplicate,
          "A matching record already exists, possibly archived. Search for it and use or restore it. Create another only if the user explicitly requests a duplicate.",
          409,
        );
        tx.set(guard, { revision: (guardDoc.data()?.revision ?? 0) + 1 });
      }
      const at = Date.now();
      const saved: Data = {
        ...after,
        ...(creating ? { createdAt: at } : {}),
        updatedAt: at,
        revision: (before.revision ?? 0) + 1,
      };
      const verb = creating
        ? "created"
        : name === "record_archive"
          ? args.archived
            ? "archived"
            : "restored"
          : name === "repair_resolve"
            ? "resolved"
            : "updated";
      const receipt = {
        id: requestId,
        operation: definition.operation!,
        status: "verified_persisted" as const,
        message: `${kind === "notes" ? "Note" : kind === "properties" ? "Property" : kind === "repairs" ? "Repair" : kind === "customers" ? "Customer" : "Job"} ${verb}${kind === "notes" ? "." : " in the demo CRM."}`,
        recordId,
        resource: kind,
        simulated: kind !== "notes",
        createdAt: at,
        actorId: identity.uid,
        actorName: member.name,
        ...(kind === "jobs"
          ? { jobId: recordId }
          : saved.jobId
            ? { jobId: saved.jobId }
            : {}),
        digest,
        conversationId,
      };
      tx.set(target, saved);
      tx.create(receiptRef, receipt);
      this.service.audit(
        tx,
        tenant,
        identity.uid,
        definition.operation!,
        recordId,
      );
      return {
        ...this.service.publicReceipt(receipt),
        record: this.publicRecord(kind, recordId, saved),
      };
    });
  }
}

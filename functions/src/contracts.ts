import { z } from "zod";
export const scopes = ["own", "assigned", "all"] as const;
export type Scope = (typeof scopes)[number];
export const permissionSchema = z
  .object({
    "job.read": z.enum(["assigned", "all"]).optional(),
    "job.update": z.enum(["assigned", "all"]).optional(),
    "business_note.create": z.enum(["assigned", "all"]).optional(),
    "business_note.list": z.enum(scopes).optional(),
    "service_request.create": z.enum(["assigned", "all"]).optional(),
  })
  .strict();
export const defaultPermissions = {
  "job.read": "assigned",
  "job.update": "assigned",
  "business_note.create": "assigned",
  "business_note.list": "own",
};
export type Permissions = z.infer<typeof permissionSchema>;
export type Member = {
  uid: string;
  name: string;
  email: string;
  role: "owner" | "technician";
  active: boolean;
  permissions: Permissions;
  jobIds: string[];
  version: number;
};
export type Identity = {
  uid: string;
  email: string;
  authTime: number;
  verified: boolean;
};
export type Status =
  | "verified_persisted"
  | "provider_accepted"
  | "pending_confirmation"
  | "rejected"
  | "failed";
export type Receipt = {
  id: string;
  operation: string;
  status: Status;
  message: string;
  recordId?: string;
  simulated: boolean;
  createdAt: number;
  actorId: string;
  actorName: string;
  resource?: string;
};
export const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const text = (max = 2000) => z.string().trim().min(1).max(max);
export const jobStatus = z.enum(["scheduled", "in_progress", "completed"]);
export const jobArgs = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("business_note.create"),
      arguments: z.object({ jobId: id, text: text() }).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("job.update"),
      arguments: z.object({ jobId: id, status: jobStatus }).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("service_request.create"),
      arguments: z.object({ jobId: id, text: text() }).strict(),
    })
    .strict(),
]);
export const operationInput = z
  .object({ key: text(128), conversationId: id, proposal: jobArgs })
  .strict();
export const customerInput = z
  .object({
    name: text(120),
    email: z.union([z.email(), z.literal("")]),
    phone: z.string().trim().max(40),
  })
  .strict();
export const propertyInput = z
  .object({ customerId: id, address: text(250), label: text(120) })
  .strict();
export const jobInput = z
  .object({ propertyId: id, title: text(160), date: z.iso.date() })
  .strict();
export const inviteInput = z
  .object({
    name: text(120),
    email: z.email().transform((v) => v.toLowerCase()),
    permissions: permissionSchema,
    jobIds: z.array(id).max(100),
  })
  .strict();
export const staffInput = z
  .object({
    name: text(120),
    active: z.boolean(),
    permissions: permissionSchema,
    jobIds: z.array(id).max(100),
  })
  .strict();
export const jobOperations = {
  "business_note.create": { risk: "ROUTINE", provider: "native" },
  "job.update": { risk: "ROUTINE", provider: "fake_crm" },
  "service_request.create": { risk: "SENSITIVE", provider: "fake_crm" },
} as const;
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  message: string,
  status = 403,
): asserts condition {
  if (!condition) throw new AppError(status, message);
}

export type Permission =
  | "job.read"
  | "job.update"
  | "business_note.create"
  | "business_note.list"
  | "service_request.create";
export type Permissions = Partial<
  Record<Permission, "own" | "assigned" | "all">
>;
export type Member = {
  id?: string;
  uid: string;
  name: string;
  email: string;
  role: "owner" | "technician";
  active: boolean;
  permissions: Permissions;
  jobIds: string[];
  version: number;
};
export type Customer = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
};
export type Property = {
  id: string;
  customerId: string;
  label: string;
  address: string;
};
export type Job = {
  id: string;
  propertyId: string;
  title: string;
  date: string;
  status: "scheduled" | "in_progress" | "completed";
};
export type Note = {
  id: string;
  jobId: string;
  text: string;
  authorName: string;
  authorId: string;
  createdAt: number;
};
export type Repair = {
  id: string;
  jobId: string;
  text: string;
  status: "open" | "resolved";
  createdAt: number;
};
export type Receipt = {
  id: string;
  operation: string;
  status: string;
  message: string;
  actorName: string;
  jobId?: string;
  createdAt: number;
  args?: { jobId: string; text?: string };
  expiresAt?: number;
};
export type Invitation = {
  id: string;
  name: string;
  email: string;
  status: string;
  expiresAt: number;
};
export type Workspace = {
  company: { id: string; name: string };
  member: Member;
  customers: Customer[];
  properties: Property[];
  jobs: Job[];
  notes: Note[];
  requests: Repair[];
  receipts: Receipt[];
  team: Member[];
  invitations: Invitation[];
  approvals: Receipt[];
};
export type Company = { id: string; name: string; role: string };
export const permissionLabels: Record<Permission, string> = {
  "job.read": "View jobs",
  "job.update": "Update job status",
  "business_note.create": "Add service notes",
  "business_note.list": "Read service notes",
  "service_request.create": "Request repairs",
};
export const defaultPermissions: Permissions = {
  "job.read": "assigned",
  "job.update": "assigned",
  "business_note.create": "assigned",
  "business_note.list": "own",
};

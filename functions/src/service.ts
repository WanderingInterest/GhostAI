import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  Firestore,
  Transaction,
  DocumentReference,
} from "firebase-admin/firestore";
import {
  AppError,
  assert,
  Member,
  Identity,
  Permissions,
  Receipt,
  Scope,
  Status,
  jobOperations,
  operationInput,
  staffInput,
  inviteInput,
  customerInput,
  propertyInput,
  jobInput,
  id,
  text,
} from "./contracts";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const now = () => Date.now();
const SESSION_MAX = 24 * 60 * 60 * 1000;
const RECENT_AUTH = 15 * 60 * 1000;
type Data = Record<string, any>;

export class Service {
  constructor(public db: Firestore) {}
  org(tenant: string) {
    id.parse(tenant);
    return this.db.doc(`organizations/${tenant}`);
  }
  member(tenant: string, uid: string) {
    return this.org(tenant).collection("members").doc(uid);
  }
  async membership(
    tx: Transaction,
    tenant: string,
    uid: string,
    owner = false,
  ): Promise<Member> {
    const snap = await tx.get(this.member(tenant, uid));
    const member = snap.data() as Member | undefined;
    assert(member?.active, "Your company access is unavailable.");
    if (owner)
      assert(member.role === "owner", "Only an owner can make this change.");
    return member;
  }
  audit(
    tx: Transaction,
    tenant: string,
    actor: string,
    event: string,
    subject: string,
  ) {
    tx.create(this.org(tenant).collection("audit").doc(), {
      actor,
      event,
      subject,
      createdAt: now(),
    });
  }
  recent(identity: Identity) {
    assert(
      now() - identity.authTime * 1000 < RECENT_AUTH,
      "Please sign in again to confirm this change.",
      401,
    );
  }
  async me(identity: Identity) {
    const profile = await this.db.doc(`users/${identity.uid}`).get();
    const tenants: string[] = profile.data()?.tenantIds ?? [];
    const companies = [];
    for (const tenant of tenants.slice(0, 20)) {
      const [member, org] = await Promise.all([
        this.member(tenant, identity.uid).get(),
        this.org(tenant).get(),
      ]);
      if (member.data()?.active && org.exists)
        companies.push({
          id: tenant,
          name: org.data()!.name,
          role: member.data()!.role,
        });
    }
    return { companies };
  }
  async createCompany(identity: Identity, input: unknown) {
    const name = text(120).parse(input);
    assert(identity.verified, "Verify your email before creating a company.");
    this.recent(identity);
    // One bootstrap workspace per user; retries return it rather than duplicate a company.
    const tenant = hash(`owner:${identity.uid}`).slice(0, 32);
    const ref = this.org(tenant);
    return this.db.runTransaction(async (tx) => {
      const [org, profile] = await Promise.all([
        tx.get(ref),
        tx.get(this.db.doc(`users/${identity.uid}`)),
      ]);
      if (org.exists) return { id: tenant };
      assert(
        (profile.data()?.tenantIds ?? []).length < 20,
        "Company limit reached.",
      );
      tx.create(ref, {
        name,
        ownerId: identity.uid,
        createdAt: now(),
        mode: "demo_crm",
      });
      tx.create(this.member(tenant, identity.uid), {
        uid: identity.uid,
        name: identity.email.split("@")[0],
        email: identity.email,
        role: "owner",
        active: true,
        permissions: {},
        jobIds: [],
        version: 1,
      });
      tx.set(
        this.db.doc(`users/${identity.uid}`),
        { tenantIds: FieldValue.arrayUnion(tenant) },
        { merge: true },
      );
      this.audit(tx, tenant, identity.uid, "company.created", tenant);
      return { id: tenant };
    });
  }
  async authorizeJob(
    tx: Transaction,
    tenant: string,
    member: Member,
    operation: keyof Permissions,
    jobId: string,
  ) {
    const job = await tx.get(this.org(tenant).collection("jobs").doc(jobId));
    assert(job.exists, "Job not found.", 404);
    assert(
      !job.data()!.archivedAt,
      "This job is archived. Restore it before making changes.",
      409,
    );
    const property = await tx.get(
      this.org(tenant).collection("properties").doc(job.data()!.propertyId),
    );
    assert(
      property.exists && !property.data()!.archivedAt,
      "This property's access is unavailable.",
      409,
    );
    const customer = await tx.get(
      this.org(tenant).collection("customers").doc(property.data()!.customerId),
    );
    assert(
      customer.exists && !customer.data()!.archivedAt,
      "This customer is archived or unavailable.",
      409,
    );
    const scope: Scope | undefined =
      member.role === "owner" ? "all" : member.permissions[operation];
    assert(scope, "Your access does not include this action.");
    assert(
      scope === "all" || member.jobIds.includes(jobId),
      "This job is not assigned to you.",
    );
    return { job: job.data()!, scope };
  }
  async state(identity: Identity, tenant: string) {
    // One read transaction gives a consistent membership/scope snapshot.
    return this.db.runTransaction(async (tx) => {
      const member = await this.membership(tx, tenant, identity.uid);
      const org = await tx.get(this.org(tenant));
      const owner = member.role === "owner";
      const collections = [
        "customers",
        "properties",
        "jobs",
        "notes",
        "requests",
        "receipts",
        "members",
        "invites",
      ] as const;
      const snapshots = await Promise.all(
        collections.map((name) =>
          tx.get(this.org(tenant).collection(name).limit(500)),
        ),
      );
      const docs: Record<string, Data[]> = {};
      collections.forEach((name, i) => {
        docs[name] = snapshots[i].docs.map((d) =>
          (({ _digest, ...data }) => ({ ...data, id: d.id }))(d.data()),
        );
      });
      for (const kind of [
        "customers",
        "properties",
        "jobs",
        "notes",
        "requests",
      ])
        docs[kind] = docs[kind].filter((record) => !record.archivedAt);
      const permissions = member.permissions;
      const can = (op: keyof Permissions, jobId: string) =>
        owner ||
        Boolean(
          permissions[op] &&
          (permissions[op] === "all" || member.jobIds.includes(jobId)),
        );
      const jobs = docs.jobs.filter((job) => can("job.read", job.id));
      const propertyIds = new Set(jobs.map((j) => j.propertyId));
      const properties = owner
        ? docs.properties
        : docs.properties.filter((p) => propertyIds.has(p.id));
      const customerIds = new Set(properties.map((p) => p.customerId));
      const customers = owner
        ? docs.customers
        : docs.customers
            .filter((c) => customerIds.has(c.id))
            .map((c) => ({ id: c.id, name: c.name }));
      const activeJobs = new Set(docs.jobs.map((j) => j.id));
      const notes = docs.notes.filter(
        (n) =>
          activeJobs.has(n.jobId) &&
          can("business_note.list", n.jobId) &&
          (owner ||
            permissions["business_note.list"] !== "own" ||
            n.authorId === identity.uid),
      );
      const receipts = docs.receipts
        .filter(
          (r) =>
            (owner || r.actorId === identity.uid) &&
            (!r.jobId || owner || can("job.read", r.jobId)),
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20);
      return {
        company: { id: tenant, name: org.data()!.name },
        member,
        customers,
        properties,
        jobs,
        notes,
        requests: docs.requests.filter(
          (r) => activeJobs.has(r.jobId) && (owner || can("job.read", r.jobId)),
        ),
        receipts: receipts.map((r) => ({
          ...this.publicReceipt(r),
          jobId: r.jobId,
        })),
        team: owner ? docs.members : [],
        invitations: owner
          ? docs.invites.map((i) => ({
              id: i.id,
              name: i.name,
              email: i.email,
              status: i.status,
              expiresAt: i.expiresAt,
            }))
          : [],
        approvals: owner
          ? docs.receipts.filter((r) => r.status === "pending_confirmation")
          : [],
      };
    });
  }
  async createRecord(
    identity: Identity,
    tenant: string,
    kind: "customers" | "properties" | "jobs",
    input: unknown,
    key: string,
  ) {
    const data =
      kind === "customers"
        ? customerInput.parse(input)
        : kind === "properties"
          ? propertyInput.parse(input)
          : jobInput.parse(input);
    text(128).parse(key);
    this.recent(identity);
    const recordId = hash(`${identity.uid}:${kind}:${key}`).slice(0, 32);
    const ref = this.org(tenant).collection(kind).doc(recordId);
    const proposal = hash(canonical(data));
    return this.db.runTransaction(async (tx) => {
      await this.membership(tx, tenant, identity.uid, true);
      const existing = await tx.get(ref);
      const guard = this.org(tenant).collection("crmGuards").doc(kind);
      const guardDoc = await tx.get(guard);
      if (existing.exists) {
        assert(
          existing.data()!._digest === proposal,
          "This request was already used for different details.",
          409,
        );
        return { id: recordId };
      }
      if (kind === "properties") {
        const customer = await tx.get(
          this.org(tenant)
            .collection("customers")
            .doc((data as any).customerId),
        );
        assert(
          customer.exists && !customer.data()!.archivedAt,
          "Customer not found or archived.",
          404,
        );
      }
      if (kind === "jobs") {
        const property = await tx.get(
          this.org(tenant)
            .collection("properties")
            .doc((data as any).propertyId),
        );
        assert(
          property.exists && !property.data()!.archivedAt,
          "Property not found or archived.",
          404,
        );
      }
      tx.create(ref, {
        ...data,
        ...(kind === "jobs" ? { status: "scheduled" } : {}),
        createdAt: now(),
        revision: 1,
        _digest: proposal,
      });
      this.audit(tx, tenant, identity.uid, `${kind}.created`, recordId);
      tx.set(guard, { revision: (guardDoc.data()?.revision ?? 0) + 1 });
      return { id: recordId };
    });
  }
  async updateRecord(
    identity: Identity,
    tenant: string,
    kind: "customers" | "properties" | "jobs",
    recordId: string,
    input: unknown,
  ) {
    id.parse(recordId);
    this.recent(identity);
    const data =
      kind === "customers"
        ? customerInput.parse(input)
        : kind === "properties"
          ? propertyInput.parse(input)
          : jobInput.parse(input);
    return this.db.runTransaction(async (tx) => {
      await this.membership(tx, tenant, identity.uid, true);
      const ref = this.org(tenant).collection(kind).doc(recordId);
      const record = await tx.get(ref);
      assert(
        record.exists && !record.data()!.archivedAt,
        "Record not found or archived.",
        404,
      );
      if (kind === "properties") {
        const customer = await tx.get(
          this.org(tenant)
            .collection("customers")
            .doc((data as any).customerId),
        );
        assert(
          customer.exists && !customer.data()!.archivedAt,
          "Customer not found or archived.",
          404,
        );
      }
      if (kind === "jobs") {
        const property = await tx.get(
          this.org(tenant)
            .collection("properties")
            .doc((data as any).propertyId),
        );
        assert(
          property.exists && !property.data()!.archivedAt,
          "Property not found or archived.",
          404,
        );
      }
      tx.update(ref, {
        ...data,
        updatedAt: now(),
        revision: FieldValue.increment(1),
      });
      this.audit(tx, tenant, identity.uid, `${kind}.updated`, recordId);
      return { id: recordId };
    });
  }
  async invite(identity: Identity, tenant: string, input: unknown) {
    this.recent(identity);
    const data = inviteInput.parse(input);
    const token = randomBytes(32).toString("base64url");
    const ref = this.org(tenant).collection("invites").doc(hash(token));
    const expiresAt = now() + 7 * 24 * 60 * 60 * 1000;
    return this.db.runTransaction(async (tx) => {
      await this.membership(tx, tenant, identity.uid, true);
      for (const jobId of data.jobIds)
        assert(
          (await tx.get(this.org(tenant).collection("jobs").doc(jobId))).exists,
          "Assigned job not found.",
          404,
        );
      tx.create(ref, {
        ...data,
        status: "pending",
        expiresAt,
        createdAt: now(),
      });
      this.audit(tx, tenant, identity.uid, "staff.invited", ref.id);
      return { token, tenant, expiresAt };
    });
  }
  async acceptInvite(identity: Identity, tenant: string, token: string) {
    assert(
      identity.verified,
      "Verify your email before accepting an invitation.",
    );
    text(100).parse(token);
    this.recent(identity);
    const ref = this.org(tenant).collection("invites").doc(hash(token));
    return this.db.runTransaction(async (tx) => {
      const invite = await tx.get(ref);
      const existing = await tx.get(this.member(tenant, identity.uid));
      const profile = await tx.get(this.db.doc(`users/${identity.uid}`));
      const data = invite.data();
      assert(
        data && data.status === "pending" && data.expiresAt > now(),
        "This invitation is no longer available.",
        400,
      );
      assert(
        data.email === identity.email.toLowerCase(),
        "Sign in with the email address this invitation was sent to.",
      );
      assert(
        !existing.exists,
        "You already have a membership in this company.",
        409,
      );
      assert(
        (profile.data()?.tenantIds ?? []).length < 20,
        "Company limit reached.",
      );
      tx.create(this.member(tenant, identity.uid), {
        uid: identity.uid,
        name: data.name,
        email: identity.email,
        role: "technician",
        active: true,
        permissions: data.permissions,
        jobIds: data.jobIds,
        version: 1,
      });
      tx.update(ref, {
        status: "accepted",
        acceptedBy: identity.uid,
        acceptedAt: now(),
      });
      tx.set(
        this.db.doc(`users/${identity.uid}`),
        { tenantIds: FieldValue.arrayUnion(tenant) },
        { merge: true },
      );
      this.audit(tx, tenant, identity.uid, "staff.joined", identity.uid);
      return { id: tenant };
    });
  }
  async editMember(
    identity: Identity,
    tenant: string,
    uid: string,
    input: unknown,
  ) {
    this.recent(identity);
    id.parse(uid);
    const data = staffInput.parse(input);
    return this.db.runTransaction(async (tx) => {
      await this.membership(tx, tenant, identity.uid, true);
      const member = await tx.get(this.member(tenant, uid));
      assert(
        member.exists && member.data()!.role === "technician",
        "Technician not found.",
        404,
      );
      for (const jobId of data.jobIds)
        assert(
          (await tx.get(this.org(tenant).collection("jobs").doc(jobId))).exists,
          "Assigned job not found.",
          404,
        );
      tx.update(member.ref, { ...data, version: FieldValue.increment(1) });
      this.audit(tx, tenant, identity.uid, "staff.updated", uid);
      return { id: uid };
    });
  }
  async cancelInvite(identity: Identity, tenant: string, inviteId: string) {
    this.recent(identity);
    id.parse(inviteId);
    return this.db.runTransaction(async (tx) => {
      await this.membership(tx, tenant, identity.uid, true);
      const ref = this.org(tenant).collection("invites").doc(inviteId);
      const invite = await tx.get(ref);
      assert(
        invite.exists && invite.data()!.status === "pending",
        "Invitation is no longer pending.",
        409,
      );
      tx.update(ref, { status: "revoked" });
      this.audit(tx, tenant, identity.uid, "invite.revoked", inviteId);
      return { id: inviteId };
    });
  }
  async submit(identity: Identity, tenant: string, input: unknown) {
    const payload = operationInput.parse(input);
    const { operation, arguments: args } = payload.proposal;
    const requestId = hash(`${identity.uid}:${payload.key}`);
    const ref = this.org(tenant).collection("receipts").doc(requestId);
    const proposalDigest = hash(
      canonical({
        tenant,
        uid: identity.uid,
        conversationId: payload.conversationId,
        operation,
        args,
        provider: jobOperations[operation].provider,
      }),
    );
    return this.db.runTransaction(async (tx) => {
      const member = await this.membership(tx, tenant, identity.uid);
      const { job } = await this.authorizeJob(
        tx,
        tenant,
        member,
        operation,
        args.jobId,
      );
      const conversationRef = this.org(tenant)
        .collection("conversations")
        .doc(hash(`${identity.uid}:${payload.conversationId}`));
      const conversation = await tx.get(conversationRef);
      const existing = await tx.get(ref);
      if (existing.exists) {
        assert(
          existing.data()!.digest === proposalDigest,
          "This request was already used for different details.",
          409,
        );
        return this.publicReceipt(existing.data()!);
      }
      const sensitive = jobOperations[operation].risk === "SENSITIVE";
      const receipt: Data = {
        id: requestId,
        operation,
        status: sensitive ? "pending_confirmation" : "verified_persisted",
        message: sensitive
          ? "Waiting for owner approval."
          : operation === "business_note.create"
            ? "Note saved."
            : "Job updated in the demo CRM.",
        recordId: sensitive ? null : requestId,
        simulated: jobOperations[operation].provider === "fake_crm",
        createdAt: now(),
        actorId: identity.uid,
        actorName: member.name,
        jobId: args.jobId,
        digest: proposalDigest,
        args,
        conversationId: payload.conversationId,
        requesterVersion: member.version,
        requesterAuthTime: identity.authTime,
        jobRevision: job.revision ?? 0,
        expiresAt: now() + 10 * 60 * 1000,
        decision: sensitive ? "pending" : "not_required",
      };
      if (!sensitive) {
        if (operation === "business_note.create")
          tx.create(this.org(tenant).collection("notes").doc(requestId), {
            jobId: args.jobId,
            text: args.text,
            authorId: identity.uid,
            authorName: member.name,
            createdAt: now(),
            revision: 1,
          });
        else if (operation === "job.update")
          tx.update(this.org(tenant).collection("jobs").doc(args.jobId), {
            status: args.status,
            updatedAt: now(),
            revision: FieldValue.increment(1),
          });
      }
      if (!conversation.exists)
        tx.create(conversationRef, {
          actorId: identity.uid,
          channel: "web",
          createdAt: now(),
        });
      tx.create(ref, receipt);
      this.audit(
        tx,
        tenant,
        identity.uid,
        sensitive ? "approval.requested" : "operation.verified_persisted",
        requestId,
      );
      return this.publicReceipt(receipt);
    });
  }
  publicReceipt(data: Data): Receipt {
    return {
      id: data.id,
      operation: data.operation,
      status: data.status,
      message: data.message,
      ...(data.recordId ? { recordId: data.recordId } : {}),
      simulated: data.simulated,
      createdAt: data.createdAt,
      actorId: data.actorId,
      actorName: data.actorName,
      ...(data.resource ? { resource: data.resource } : {}),
    };
  }
  async approve(
    identity: Identity,
    tenant: string,
    requestId: string,
    approve: boolean,
  ) {
    this.recent(identity);
    id.parse(requestId);
    const ref = this.org(tenant).collection("receipts").doc(requestId);
    const initial = await ref.get();
    assert(initial.exists, "Request not found.", 404);
    // Read live Firebase identity outside the retryable DB transaction. Membership version
    // inside the transaction is the immediate revocation boundary for queued operations.
    let requesterValid = false;
    try {
      const user = await getAuth().getUser(initial.data()!.actorId);
      requesterValid =
        !user.disabled &&
        (!user.tokensValidAfterTime ||
          initial.data()!.requesterAuthTime * 1000 >=
            new Date(user.tokensValidAfterTime).getTime());
    } catch {
      requesterValid = false;
    }
    return this.db.runTransaction(async (tx) => {
      await this.membership(tx, tenant, identity.uid, true);
      const snap = await tx.get(ref);
      const receipt = snap.data()!;
      assert(
        receipt.status === "pending_confirmation",
        "This request has already been resolved.",
        409,
      );
      const requestMember = await tx.get(this.member(tenant, receipt.actorId));
      const member = requestMember.data() as Member | undefined;
      let reason: string | null = null;
      if (!approve) reason = "Request declined by owner.";
      else if (receipt.expiresAt <= now())
        reason = "Approval expired. Ask the technician to submit again.";
      else if (
        !requesterValid ||
        now() - receipt.requesterAuthTime * 1000 > SESSION_MAX
      )
        reason = "The requesting session is no longer valid.";
      else if (!member?.active || member.version !== receipt.requesterVersion)
        reason = "Technician access changed. Ask them to submit again.";
      const expected = hash(
        canonical({
          tenant,
          uid: receipt.actorId,
          conversationId: receipt.conversationId,
          operation: receipt.operation,
          args: receipt.args,
          provider: "fake_crm",
        }),
      );
      if (
        approve &&
        !reason &&
        (receipt.digest !== expected ||
          receipt.operation !== "service_request.create")
      )
        reason = "Request details no longer match the approval.";
      if (approve && !reason) {
        try {
          const { job } = await this.authorizeJob(
            tx,
            tenant,
            member!,
            "service_request.create",
            receipt.args.jobId,
          );
          if (
            receipt.jobRevision === undefined ||
            receipt.jobRevision !== (job.revision ?? 0)
          )
            reason =
              "Job details changed. Submit a new repair request for the current job.";
        } catch (error) {
          if (error instanceof AppError) reason = error.message;
          else throw error;
        }
      }
      const updated = {
        ...receipt,
        status: reason ? "rejected" : "verified_persisted",
        decision: reason ? "rejected" : "approved",
        message: reason ?? "Repair request saved in the demo CRM.",
        resolvedAt: now(),
        approverId: identity.uid,
        recordId: reason ? null : requestId,
      };
      if (!reason)
        tx.create(this.org(tenant).collection("requests").doc(requestId), {
          jobId: receipt.args.jobId,
          text: receipt.args.text,
          status: "open",
          createdAt: now(),
          createdBy: receipt.actorId,
          revision: 1,
        });
      tx.update(ref, updated);
      this.audit(
        tx,
        tenant,
        identity.uid,
        reason ? "operation.rejected" : "operation.verified_persisted",
        requestId,
      );
      return this.publicReceipt(updated);
    });
  }
  async resolveRepair(identity: Identity, tenant: string, requestId: string) {
    this.recent(identity);
    id.parse(requestId);
    return this.db.runTransaction(async (tx) => {
      await this.membership(tx, tenant, identity.uid, true);
      const ref = this.org(tenant).collection("requests").doc(requestId);
      const request = await tx.get(ref);
      assert(
        request.exists && !request.data()!.archivedAt,
        "Repair request not found or archived.",
        404,
      );
      tx.update(ref, {
        status: "resolved",
        resolvedAt: now(),
        updatedAt: now(),
        revision: FieldValue.increment(1),
      });
      this.audit(tx, tenant, identity.uid, "repair.resolved", requestId);
      return { id: requestId };
    });
  }
}

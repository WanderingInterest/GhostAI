import { createHash } from "node:crypto";
import { z } from "zod";
import policy from "./messaging-policy.json";
import { assert, id, Identity } from "./contracts";
import { Service } from "./service";

const inputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("opt_in"),
      key: id,
      phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
      version: z.literal(policy.version),
      agreed: z.literal(true),
      expectedRevision: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      action: z.literal("withdraw"),
      key: id,
      expectedRevision: z.number().int().min(0),
    })
    .strict(),
]);
export class MessagingConsent {
  constructor(private service: Service) {}
  private ref(tenant: string, uid: string) {
    return this.service.org(tenant).collection("messagingConsents").doc(uid);
  }
  private view(data: Record<string, any> | undefined) {
    return {
      status: data?.status ?? "not_enrolled",
      phone: data?.phone ?? "",
      revision: data?.revision ?? 0,
      consentedAt: data?.consentedAt ?? null,
      withdrawnAt: data?.withdrawnAt ?? null,
      version: data?.version ?? null,
      // Consent is not phone ownership. Twilio enrollment must perform its own
      // verification and check current consent immediately before every dispatch.
      phoneVerified: false,
      smsEnabled: false,
      policy,
    };
  }
  async status(identity: Identity, tenant: string) {
    return this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid);
      return this.view((await tx.get(this.ref(tenant, identity.uid))).data());
    });
  }
  async save(
    identity: Identity,
    tenant: string,
    input: unknown,
    sourceOrigin: string | null,
  ) {
    assert(
      identity.verified,
      "Verify your email before choosing SMS preferences.",
    );
    const data = inputSchema.parse(input);
    const digest = createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
    const ref = this.ref(tenant, identity.uid),
      event = ref.collection("events").doc(data.key);
    return this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid);
      const [current, previous] = await Promise.all([
        tx.get(ref),
        tx.get(event),
      ]);
      if (previous.exists) {
        assert(
          previous.data()!.digest === digest,
          "This preference request was used for different details.",
          409,
        );
        return this.view(current.data());
      }
      assert(
        (current.data()?.revision ?? 0) === data.expectedRevision,
        "Your SMS preferences changed. Refresh before saving.",
        409,
      );
      const at = Date.now(),
        revision = data.expectedRevision + 1;
      const next =
        data.action === "opt_in"
          ? {
              status: "consented_pending_verification",
              phone: data.phone,
              consentedAt: at,
              withdrawnAt: null,
              version: policy.version,
              revision,
            }
          : {
              status: "withdrawn",
              phone: current.data()?.phone ?? "",
              consentedAt: current.data()?.consentedAt ?? null,
              withdrawnAt: at,
              version: current.data()?.version ?? policy.version,
              revision,
            };
      tx.set(ref, { ...next, actorId: identity.uid, updatedAt: at });
      tx.create(event, {
        ...next,
        digest,
        action: data.action,
        actorId: identity.uid,
        tenantId: tenant,
        recordedAt: at,
        channel: "web",
        sourceOrigin,
        sourcePath: policy.consentPath,
        disclosure: policy.disclosure,
        program: policy.program,
        sender: policy.sender,
        privacyVersion: policy.version,
        privacyPath: policy.privacyPath,
        termsVersion: policy.version,
        termsPath: policy.termsPath,
        affirmativeCheckbox: data.action === "opt_in",
        phoneVerified: false,
      });
      this.service.audit(
        tx,
        tenant,
        identity.uid,
        `messaging.${data.action}`,
        event.id,
      );
      return this.view(next);
    });
  }
}

import { createHash, randomBytes } from "node:crypto";
import twilio from "twilio";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";
import { AppError, assert, Identity, id } from "./contracts";
import { encryptKey, decryptKey } from "./credentials";
import { Service } from "./service";
import { ExecutiveRuntime } from "./agent/runtime";
import basePolicy from "./messaging-policy.json";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
const sid = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}[a-fA-F0-9]{32}$`));
export const smsSetup = z
  .object({
    accountSid: sid("AC"),
    authToken: z.string().regex(/^[a-fA-F0-9]{32}$/),
    phone,
    sender: z.string().trim().min(2).max(100),
    supportEmail: z.email(),
    // An explicit operator attestation, never inferred from API access alone.
    approvedForMessaging: z.boolean().default(false),
  })
  .strict();
export function smsPolicy(config: any) {
  if (!config?.sender) return basePolicy;
  const disclosure = `I agree to receive automated work-related text messages from ${config.sender} through GhostAI at the mobile number I provide. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. SMS is optional and is not a condition of purchase, account creation, or use of the web app. Support: ${config.supportEmail}.`;
  return {
    ...basePolicy,
    sender: config.sender,
    program: `${config.sender} Technician Assistant`,
    disclosure,
    version: `sms_${hash(JSON.stringify([basePolicy.version, config.sender, config.phone, config.supportEmail])).slice(0, 24)}`,
  };
}
export class Sms {
  constructor(
    private service: Service,
    private master: () => string,
    private executive?: ExecutiveRuntime,
    private client: typeof twilio = twilio,
  ) {}
  connection(tenant: string) {
    return this.service
      .org(tenant)
      .collection("privateCredentials")
      .doc("twilio");
  }
  program(tenant: string) {
    return this.service.org(tenant).collection("settings").doc("messaging");
  }
  binding(tenant: string, number: string) {
    return this.service.org(tenant).collection("smsPhones").doc(hash(number));
  }
  consent(tenant: string, uid: string) {
    return this.service.org(tenant).collection("messagingConsents").doc(uid);
  }
  url(tenant: string, action = "inbound", messageId?: string) {
    id.parse(tenant);
    const project = process.env.GCLOUD_PROJECT;
    assert(
      project && /^[a-z0-9-]+$/.test(project),
      "Firebase project is not configured.",
      503,
    );
    // This canonical public URL is also used for signature validation. Never trust Host/Forwarded.
    return `https://us-central1-${project}.cloudfunctions.net/twilioWebhook/${tenant}/${action}${messageId ? `/${messageId}` : ""}`;
  }
  private credentials(config: any, tenant: string) {
    return JSON.parse(
      decryptKey(config.sealed, this.master(), tenant, "twilio"),
    ) as z.infer<typeof smsSetup>;
  }
  async status(identity: Identity, tenant: string) {
    return this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid, true);
      const data = (await tx.get(this.program(tenant))).data();
      return {
        status: data?.enabled
          ? "connected"
          : data?.phone
            ? "pending"
            : "not_connected",
        phone: data?.phone ?? null,
        sender: data?.sender ?? null,
        supportEmail: data?.supportEmail ?? null,
        updatedAt: data?.updatedAt ?? null,
      };
    });
  }
  async connect(identity: Identity, tenant: string, input: unknown) {
    this.service.recent(identity);
    await this.service.db.runTransaction((tx) =>
      this.service.membership(tx, tenant, identity.uid, true),
    );
    try {
      await this.configure(tenant, input, identity.uid, identity);
      return await this.status(identity, tenant);
    } catch (error) {
      if (error instanceof AppError || error instanceof z.ZodError) throw error;
      throw new AppError(
        502,
        "Twilio could not finish setup. Check the Account SID, Auth Token, and number, then try again. Messaging stays off if setup did not finish.",
      );
    }
  }
  // Called by owner-authorized assisted onboarding or the privileged operator CLI.
  async configure(
    tenant: string,
    input: unknown,
    operator: string,
    identity?: Identity,
  ) {
    id.parse(tenant);
    assert(
      process.env.FUNCTIONS_EMULATOR !== "true",
      "Real Twilio credentials cannot be stored in the emulator.",
      409,
    );
    const data = smsSetup.parse(input);
    assert(
      (await this.service.org(tenant).get()).exists,
      "Company not found.",
      404,
    );
    const provider = this.client(data.accountSid, data.authToken, {
      autoRetry: false,
      timeout: 8000,
    });
    const numbers = await provider.incomingPhoneNumbers.list({
      phoneNumber: data.phone,
      limit: 2,
    });
    assert(
      numbers.length === 1 && numbers[0].capabilities.sms,
      "This account must own an SMS-capable Twilio number.",
      400,
    );
    // Claim the account/number globally so it cannot route to two companies.
    const route = this.service.db
      .collection("smsRoutes")
      .doc(hash(`${data.accountSid}:${data.phone}`));
    const previous = await this.connection(tenant).get();
    assert(
      !previous.exists ||
        (previous.data()!.accountSid === data.accountSid &&
          previous.data()!.phone === data.phone),
      "Disconnect the existing number before changing account or number.",
      409,
    );
    const sealed = encryptKey(
      JSON.stringify(data),
      this.master(),
      tenant,
      "twilio",
    );
    await this.service.db.runTransaction(async (tx) => {
      if (identity)
        await this.service.membership(tx, tenant, identity.uid, true);
      const [existing, current] = await Promise.all([
        tx.get(route),
        tx.get(this.connection(tenant)),
      ]);
      assert(
        !existing.exists || existing.data()!.tenant === tenant,
        "This number is already assigned to another company.",
        409,
      );
      assert(
        (current.exists &&
          previous.exists &&
          current.updateTime!.isEqual(previous.updateTime!)) ||
          (!current.exists && !previous.exists),
        "Connection changed. Try again.",
        409,
      );
      tx.set(route, { tenant });
      tx.set(this.connection(tenant), {
        sealed,
        accountSid: data.accountSid,
        phone: data.phone,
        enabled: false,
        generation: randomBytes(16).toString("hex"),
      });
      tx.set(this.program(tenant), {
        phone: data.phone,
        sender: data.sender,
        supportEmail: data.supportEmail,
        enabled: false,
        updatedAt: Date.now(),
      });
      this.service.audit(tx, tenant, operator, "sms.configured", "twilio");
    });
    // If provider setup fails, connection stays disabled and can be safely reconfigured.
    await provider
      .incomingPhoneNumbers(numbers[0].sid)
      .update({ smsUrl: this.url(tenant), smsMethod: "POST" });
    await this.service.db.runTransaction(async (tx) => {
      if (identity)
        await this.service.membership(tx, tenant, identity.uid, true);
      const current = await tx.get(this.connection(tenant));
      assert(
        current.data()?.sealed?.ciphertext === sealed.ciphertext,
        "Connection changed. Try again.",
        409,
      );
      tx.update(this.connection(tenant), {
        enabled: data.approvedForMessaging,
      });
      tx.update(this.program(tenant), { enabled: data.approvedForMessaging });
    });
    return {
      phone: data.phone,
      enabled: data.approvedForMessaging,
      inboundUrl: this.url(tenant),
    };
  }
  async disconnect(identity: Identity, tenant: string) {
    this.service.recent(identity);
    await this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid, true);
      const current = (await tx.get(this.connection(tenant))).data();
      if (current)
        tx.delete(
          this.service.db
            .collection("smsRoutes")
            .doc(hash(`${current.accountSid}:${current.phone}`)),
        );
      tx.delete(this.connection(tenant));
      tx.set(
        this.program(tenant),
        { enabled: false, updatedAt: Date.now() },
        { merge: true },
      );
      this.service.audit(
        tx,
        tenant,
        identity.uid,
        "sms.disconnected",
        "twilio",
      );
    });
    return this.status(identity, tenant);
  }
  async verification(identity: Identity, tenant: string) {
    const code = randomBytes(16).toString("hex").toUpperCase();
    const result = await this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid);
      const [consent, program, existing] = await Promise.all([
        tx.get(this.consent(tenant, identity.uid)),
        tx.get(this.program(tenant)),
        tx.get(
          this.service
            .org(tenant)
            .collection("smsChallenges")
            .doc(identity.uid),
        ),
      ]);
      const c = consent.data(),
        p = program.data();
      assert(p?.enabled, "Your company’s SMS setup is not active yet.", 409);
      assert(
        c?.status === "consented_pending_verification" &&
          c.version === smsPolicy(p).version,
        "Save your current SMS consent first.",
        409,
      );
      assert(
        !existing.exists || existing.data()!.createdAt < Date.now() - 30000,
        "Wait 30 seconds before requesting another code.",
        429,
      );
      tx.set(
        this.service.org(tenant).collection("smsChallenges").doc(identity.uid),
        {
          digest: hash(code),
          phone: c.phone,
          revision: c.revision,
          createdAt: Date.now(),
          expiresAt: Date.now() + 600000,
        },
      );
      tx.set(
        this.service
          .org(tenant)
          .collection("smsChallengeCodes")
          .doc(hash(code)),
        { uid: identity.uid, expiresAt: Date.now() + 600000 },
      );
      return { number: p.phone };
    });
    return { ...result, text: `LINK ${code}`, expiresInSeconds: 600 };
  }
  async validate(
    tenant: string,
    action: string,
    params: Record<string, string>,
    signature: string,
    messageId?: string,
  ) {
    const config = (await this.connection(tenant).get()).data();
    assert(config?.sealed, "Unknown SMS connection.", 403);
    const secret = this.credentials(config, tenant);
    assert(
      params.AccountSid === secret.accountSid &&
        twilio.validateRequest(
          secret.authToken,
          signature,
          this.url(tenant, action, messageId),
          params,
        ),
      "Invalid webhook signature.",
      403,
    );
    if (action === "inbound")
      assert(params.To === secret.phone, "Wrong destination.", 403);
    else assert(params.From === secret.phone, "Wrong sender.", 403);
    return config;
  }
  async inbound(
    tenant: string,
    params: Record<string, string>,
    signature: string,
  ) {
    const config = await this.validate(tenant, "inbound", params, signature);
    sid("SM").parse(params.MessageSid);
    phone.parse(params.From);
    const body = (params.Body ?? "").trim();
    assert(body.length <= 2000, "Message too long.", 400);
    const ref = this.service
      .org(tenant)
      .collection("smsInbox")
      .doc(params.MessageSid);
    return this.service.db.runTransaction(async (tx) => {
      const [existing, current, binding] = await Promise.all([
        tx.get(ref),
        tx.get(this.connection(tenant)),
        tx.get(this.binding(tenant, params.From)),
      ]);
      if (existing.exists) return;
      const active = current.data();
      assert(
        active?.generation === config.generation,
        "Connection changed.",
        409,
      );
      const uid = binding.data()?.uid;
      const consentRef = uid ? this.consent(tenant, uid) : null;
      const consent = consentRef ? (await tx.get(consentRef)).data() : null;
      const member = uid
        ? (
            await tx.get(
              this.service.org(tenant).collection("members").doc(uid),
            )
          ).data()
        : null;
      const program = (await tx.get(this.program(tenant))).data();
      const keyword = body.toUpperCase();
      const help =
        /^(HELP|INFO)$/.test(keyword) || params.OptOutType === "HELP";
      const stop =
        params.OptOutType === "STOP" ||
        /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/.test(
          keyword,
        );
      // Opt-out applies even while the connection is paused. START never restores web consent.
      if (stop) {
        tx.set(
          this.binding(tenant, params.From),
          { ...(binding.data() ?? {}), blocked: true, blockedAt: Date.now() },
          { merge: true },
        );
        if (consentRef && consent && consent.phone === params.From) {
          const next = {
            status: "withdrawn",
            revision: consent.revision + 1,
            withdrawnAt: Date.now(),
            phoneVerified: false,
          };
          tx.update(consentRef, next);
          tx.create(consentRef.collection("events").doc(params.MessageSid), {
            ...next,
            actorId: uid,
            channel: "sms",
            action: "withdraw",
            phone: params.From,
            recordedAt: Date.now(),
            tenantId: tenant,
          });
        }
      }
      tx.create(ref, {
        from: params.From,
        body: body.slice(0, 2000),
        uid: uid ?? null,
        generation: config.generation,
        consentRevision: consent?.revision ?? null,
        memberVersion: member?.version ?? null,
        status:
          help ||
          stop ||
          !active?.enabled ||
          params.OptOutType === "START" ||
          /^(START|YES|UNSTOP)$/.test(keyword)
            ? "ignored"
            : "queued",
        createdAt: Date.now(),
      });
      if (help && params.OptOutType !== "HELP" && program)
        return `${program.sender}: Text job questions and service notes after enrolling at https://www.ghostai.dev/sms. Reply STOP to opt out. Help: ${program.supportEmail}. Message frequency varies; message and data rates may apply.`;
    });
  }
  async process(tenant: string, messageId: string) {
    const ref = this.service.org(tenant).collection("smsInbox").doc(messageId);
    const message = await this.service.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.data()?.status !== "queued") return null;
      tx.update(ref, { status: "processing", startedAt: Date.now() });
      return snap.data()!;
    });
    if (!message) return;
    try {
      const link = /^LINK ([A-F0-9]{32})$/i.exec(message.body);
      if (link) {
        await this.link(tenant, message, link[1].toUpperCase());
        await ref.update({ status: "completed" });
        return;
      }
      assert(message.uid, "Phone not enrolled.");
      await this.guard(tenant, message);
      const user = await getAuth().getUser(message.uid);
      assert(
        !user.disabled && user.emailVerified && user.email,
        "Account unavailable.",
      );
      const identity = {
        uid: user.uid,
        email: user.email,
        verified: true,
        authTime: Math.floor(Date.now() / 1000),
      };
      let reply: string;
      if (
        message.body.toUpperCase() === "HELP" ||
        message.body.toUpperCase() === "INFO"
      ) {
        const p = (await this.program(tenant).get()).data()!;
        reply = `${p.sender}: Text a job question or service note. Reply STOP to opt out. Help: ${p.supportEmail}. Message frequency varies; message and data rates may apply.`;
        // Advanced Opt-Out already sends its configured HELP response.
      } else {
        assert(this.executive, "Assistant unavailable.", 503);
        const history = await this.executive.turn(
          identity,
          tenant,
          {
            conversationId: `sms_${hash(`${message.uid}:${message.from}:${message.consentRevision}:${message.generation}`).slice(0, 48)}`,
            turnId: messageId,
            message: message.body,
          },
          () => this.guard(tenant, message),
        );
        const turn = history.turns.find((t) => t.id === messageId);
        reply =
          turn?.reply ||
          "Please check your assistant in the web app before trying again.";
        const receipts = turn?.receipts ?? [];
        if (receipts.length)
          reply +=
            "\n" +
            receipts
              .map(
                (r) =>
                  `${r.status === "verified_persisted" ? "Saved" : r.status === "pending_confirmation" ? "Awaiting approval" : r.status}: ${r.message}`,
              )
              .join("\n");
      }
      await this.guard(tenant, message);
      await this.service
        .org(tenant)
        .collection("smsOutbox")
        .doc(messageId)
        .create({
          ...message,
          body: reply.slice(0, 1400),
          status: "queued",
          createdAt: Date.now(),
        });
      await ref.update({ status: "completed", finishedAt: Date.now() });
    } catch {
      // Never replay a possibly committed assistant action after a crash or provider error.
      await ref.update({ status: "failed", finishedAt: Date.now() });
      // A useful failure reply never asserts that a possibly committed action failed.
      if (message.uid && !/^LINK /i.test(message.body)) {
        try {
          await this.guard(tenant, message);
          await this.service
            .org(tenant)
            .collection("smsOutbox")
            .doc(messageId)
            .create({
              ...message,
              body: "I could not finish this message. Check the Assistant and action receipts in the GhostAI web app before asking again.",
              status: "queued",
              createdAt: Date.now(),
            });
        } catch {
          /* Access may have changed or a reply already exists. */
        }
      }
    }
  }
  private async link(tenant: string, message: any, code: string) {
    await this.service.db.runTransaction(async (tx) => {
      const codeRef = this.service
        .org(tenant)
        .collection("smsChallengeCodes")
        .doc(hash(code));
      const lookup = (await tx.get(codeRef)).data();
      assert(lookup && lookup.expiresAt > Date.now(), "Code expired.");
      const challengeRef = this.service
        .org(tenant)
        .collection("smsChallenges")
        .doc(lookup.uid);
      await this.service.membership(tx, tenant, lookup.uid);
      const [challenge, consent, binding, config, program] = await Promise.all([
        tx.get(challengeRef),
        tx.get(this.consent(tenant, lookup.uid)),
        tx.get(this.binding(tenant, message.from)),
        tx.get(this.connection(tenant)),
        tx.get(this.program(tenant)),
      ]);
      const c = consent.data(),
        ch = challenge.data(),
        p = program.data();
      assert(
        config.data()?.enabled &&
          config.data()?.generation === message.generation,
        "Connection changed.",
      );
      assert(
        ch &&
          ch.digest === hash(code) &&
          ch.expiresAt > Date.now() &&
          ch.phone === message.from &&
          ch.revision === c?.revision &&
          c?.status === "consented_pending_verification" &&
          c.version === smsPolicy(p).version,
        "Code does not match current consent.",
      );
      assert(
        !binding.data()?.blockedAt || c.consentedAt > binding.data()!.blockedAt,
        "Opt in again after STOP before verifying.",
      );
      assert(
        !binding.data()?.uid || binding.data()!.uid === lookup.uid,
        "Number already belongs to another account.",
      );
      tx.set(this.binding(tenant, message.from), {
        uid: lookup.uid,
        blocked: false,
        revision: c.revision,
        verifiedAt: Date.now(),
      });
      tx.update(this.consent(tenant, lookup.uid), {
        phoneVerified: true,
        verifiedAt: Date.now(),
        status: "active",
      });
      tx.create(
        this.consent(tenant, lookup.uid)
          .collection("events")
          .doc(`verified_${hash(code)}`),
        {
          actorId: lookup.uid,
          channel: "sms",
          action: "phone_verified",
          phone: message.from,
          recordedAt: Date.now(),
          tenantId: tenant,
          revision: c.revision,
        },
      );
      tx.delete(challengeRef);
      tx.delete(codeRef);
    });
  }
  async guard(tenant: string, message: any) {
    return this.service.db.runTransaction(async (tx) => {
      const member = await this.service.membership(tx, tenant, message.uid);
      assert(
        member.version === message.memberVersion,
        "Your permissions changed. Send a new message.",
        403,
      );
      const [config, consent, binding, program] = await Promise.all([
        tx.get(this.connection(tenant)),
        tx.get(this.consent(tenant, message.uid)),
        tx.get(this.binding(tenant, message.from)),
        tx.get(this.program(tenant)),
      ]);
      const c = consent.data(),
        b = binding.data(),
        p = program.data();
      assert(
        config.data()?.enabled &&
          config.data()?.generation === message.generation &&
          c?.status === "active" &&
          c.phoneVerified &&
          c.phone === message.from &&
          c.revision === message.consentRevision &&
          c.version === smsPolicy(p).version &&
          b?.uid === message.uid &&
          !b?.blocked &&
          b?.revision === c.revision,
        "SMS enrollment is no longer active.",
        403,
      );
    });
  }
  async dispatch(tenant: string, messageId: string) {
    const ref = this.service.org(tenant).collection("smsOutbox").doc(messageId);
    const message = await this.service.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.data()?.status !== "queued") return null;
      tx.update(ref, { status: "sending", attemptedAt: Date.now() });
      return snap.data()!;
    });
    if (!message) return;
    let attempted = false;
    try {
      const user = await getAuth().getUser(message.uid);
      assert(!user.disabled && user.emailVerified, "Account unavailable.");
      const config = (await this.connection(tenant).get()).data();
      assert(config?.sealed, "Connection unavailable.");
      const secret = this.credentials(config, tenant);
      try {
        await this.guard(tenant, message);
      } catch {
        await ref.update({ status: "suppressed", finishedAt: Date.now() });
        return;
      }
      attempted = true;
      const sent = await this.client(secret.accountSid, secret.authToken, {
        autoRetry: false,
        timeout: 8000,
      }).messages.create({
        from: secret.phone,
        to: message.from,
        body: message.body,
        statusCallback: this.url(tenant, "status", messageId),
      });
      await this.service.db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        tx.update(ref, {
          providerSid: sent.sid,
          status: current?.status === "sending" ? "accepted" : current?.status,
          acceptedAt: Date.now(),
        });
      });
    } catch {
      // A timeout can happen after provider acceptance. Leave it for callback/manual reconciliation.
      await this.service.db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (current?.status === "sending")
          tx.update(ref, {
            status: attempted ? "unknown" : "suppressed",
            finishedAt: Date.now(),
          });
      });
    }
  }
  async callback(
    tenant: string,
    messageId: string,
    params: Record<string, string>,
    signature: string,
  ) {
    await this.validate(tenant, "status", params, signature, messageId);
    sid("SM").parse(params.MessageSid);
    const ref = this.service.org(tenant).collection("smsOutbox").doc(messageId);
    await this.service.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      assert(
        current &&
          params.To === current.from &&
          (!current.providerSid || current.providerSid === params.MessageSid),
        "Unknown delivery.",
        403,
      );
      const order = [
        "queued",
        "sending",
        "unknown",
        "accepted",
        "scheduled",
        "sent",
        "failed",
        "undelivered",
        "delivered",
        "read",
      ];
      const next = params.MessageStatus;
      assert(order.includes(next), "Unknown delivery status.", 400);
      if (order.indexOf(next) >= order.indexOf(current.status))
        tx.update(ref, {
          providerSid: params.MessageSid,
          status: next,
          errorCode: params.ErrorCode ?? null,
          updatedAt: Date.now(),
        });
    });
  }
}

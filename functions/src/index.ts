import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { Credentials } from "./credentials";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { Service } from "./service";
import { ExecutiveRuntime } from "./agent/runtime";
import { MessagingConsent } from "./messaging";
import { AppError, assert, Identity, id } from "./contracts";
initializeApp();
const service = new Service(getFirestore());
const vaultKey = defineSecret("GHOSTAI_VAULT_KEY");
const credentials = new Credentials(service, () =>
  process.env.FUNCTIONS_EMULATOR === "true"
    ? createHash("sha256").update("ghostai-emulator-only").digest("base64")
    : vaultKey.value(),
);
const executive = new ExecutiveRuntime(service, credentials);
const messaging = new MessagingConsent(service);
export const api = onRequest(
  {
    region: "us-central1",
    maxInstances: 10,
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
    secrets: [vaultKey],
  },
  async (req, res) => {
    const origin = req.get("origin");
    const emulator = process.env.FUNCTIONS_EMULATOR === "true";
    const allowed = (process.env.GHOSTAI_ALLOWED_ORIGINS ?? "")
      .split(",")
      .filter(Boolean);
    const local =
      origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    if (origin && !(allowed.includes(origin) || (emulator && local))) {
      res
        .status(403)
        .json({ error: "This website is not allowed to access the API." });
      return;
    }
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    try {
      assert(
        ["GET", "POST"].includes(req.method),
        "Method not supported.",
        405,
      );
      assert(
        !req.rawBody || req.rawBody.length <= 32768,
        "Request too large.",
        413,
      );
      if (req.method === "POST")
        assert(req.is("application/json"), "Use JSON for requests.", 415);
      const bearer = req.get("authorization") ?? "";
      assert(bearer.startsWith("Bearer "), "Please sign in.", 401);
      let decoded;
      try {
        decoded = await getAuth().verifyIdToken(bearer.slice(7), true);
      } catch {
        throw new AppError(401, "Your session expired. Please sign in again.");
      }
      assert(decoded.email, "Your account needs an email address.", 403);
      const identity: Identity = {
        uid: decoded.uid,
        email: decoded.email,
        authTime: decoded.auth_time,
        verified: decoded.email_verified === true,
      };
      const path = req.path.replace(/\/$/, "") || "/";
      if (path === "/me" && req.method === "GET") {
        res.json(await service.me(identity));
        return;
      }
      const body = req.body;
      if (path === "/account/revoke-sessions" && req.method === "POST") {
        z.object({}).strict().parse(body);
        service.recent(identity);
        await getAuth().revokeRefreshTokens(identity.uid);
        res.json({ message: "All devices have been signed out." });
        return;
      }
      assert(identity.verified, "Verify your email to continue.");
      const consent = path.match(
        /^\/orgs\/([a-zA-Z0-9_-]+)\/messaging-consent$/,
      );
      if (consent) {
        if (req.method === "GET")
          res.json(await messaging.status(identity, consent[1]));
        else if (req.method === "POST")
          res.json(
            await messaging.save(
              identity,
              consent[1],
              req.body,
              origin ?? null,
            ),
          );
        else throw new AppError(404, "Not found.");
        return;
      }
      const assistant = path.match(
        /^\/orgs\/([a-zA-Z0-9_-]+)\/assistant(?:\/([a-zA-Z0-9_-]+))?$/,
      );
      if (assistant) {
        const [, tenant, conversationId] = assistant;
        if (req.method === "GET")
          res.json(
            conversationId
              ? await executive.history(identity, tenant, conversationId)
              : await executive.ready(identity, tenant),
          );
        else if (req.method === "POST" && !conversationId)
          res.json(await executive.turn(identity, tenant, req.body));
        else throw new AppError(404, "Not found.");
        return;
      }
      const connection = path.match(
        /^\/orgs\/([a-zA-Z0-9_-]+)\/connections\/openai(?:\/(check|disconnect))?$/,
      );
      if (connection) {
        const [, tenant, action] = connection;
        if (req.method === "GET" && !action) {
          res.json(await credentials.status(identity, tenant));
          return;
        }
        assert(req.method === "POST", "Not found.", 404);
        // Local previews must never collect real provider keys under a demo vault key.
        assert(
          !emulator,
          "Provider connections are available in the live workspace after backend deployment.",
          409,
        );
        if (action === "check" || action === "disconnect")
          z.object({}).strict().parse(body);
        res.json(
          action === "check"
            ? await credentials.check(identity, tenant)
            : action === "disconnect"
              ? await credentials.disconnect(identity, tenant)
              : await credentials.connect(identity, tenant, body),
        );
        return;
      }
      if (path === "/companies" && req.method === "POST") {
        const input = z.object({ name: z.string() }).strict().parse(body);
        res.json(await service.createCompany(identity, input.name));
        return;
      }
      if (path === "/invitations/accept" && req.method === "POST") {
        const input = z
          .object({ tenant: id, token: z.string() })
          .strict()
          .parse(body);
        res.json(
          await service.acceptInvite(identity, input.tenant, input.token),
        );
        return;
      }
      const match = path.match(
        /^\/orgs\/([a-zA-Z0-9_-]+)\/(state|customers|properties|jobs|invites|members|operations|approvals|repairs)(?:\/([a-zA-Z0-9_-]+))?$/,
      );
      assert(match, "Not found.", 404);
      const [, tenant, resource, recordId] = match;
      if (resource === "state" && req.method === "GET" && !recordId) {
        res.json(await service.state(identity, tenant));
        return;
      }
      assert(req.method === "POST", "Not found.", 404);
      let result;
      if (
        resource === "customers" ||
        resource === "properties" ||
        resource === "jobs"
      ) {
        if (recordId)
          result = await service.updateRecord(
            identity,
            tenant,
            resource,
            recordId,
            body,
          );
        else {
          const input = z
            .object({ key: z.string(), data: z.unknown() })
            .strict()
            .parse(body);
          result = await service.createRecord(
            identity,
            tenant,
            resource,
            input.data,
            input.key,
          );
        }
      } else if (resource === "invites")
        result = recordId
          ? await service.cancelInvite(identity, tenant, recordId)
          : await service.invite(identity, tenant, body);
      else if (resource === "members" && recordId)
        result = await service.editMember(identity, tenant, recordId, body);
      else if (resource === "operations" && !recordId)
        result = await service.submit(identity, tenant, body);
      else if (resource === "approvals" && recordId)
        result = await service.approve(
          identity,
          tenant,
          recordId,
          z.object({ approve: z.boolean() }).strict().parse(body).approve,
        );
      else if (resource === "repairs" && recordId) {
        z.object({}).strict().parse(body);
        result = await service.resolveRepair(identity, tenant, recordId);
      } else throw new AppError(404, "Not found.");
      res.json(result);
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Check the form details and try again." });
        return;
      }
      console.error("Request failed", {
        type: error instanceof Error ? error.name : "unknown",
      });
      res
        .status(500)
        .json({ error: "We could not save this change. Please try again." });
    }
  },
);

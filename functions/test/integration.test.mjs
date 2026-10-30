import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "node:module";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { Service } = require("../lib/service.js");
const { ExecutiveRuntime } = require("../lib/agent/runtime.js");
assert.equal(
  process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT,
  "demo-ghostai",
  "Run tests through the demo emulator suite.",
);
assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST);
initializeApp({ projectId: "demo-ghostai" });
const service = new Service(getFirestore());
const fixtureCredentials = {
  runtimeAvailable: async () => true,
  runtimeKey: async () => "fixture-only-no-provider",
};
let rules;
const unique = () => randomUUID().replaceAll("-", "");
async function identity() {
  const uid = unique(),
    email = `${uid}@example.test`;
  await getAuth().createUser({
    uid,
    email,
    emailVerified: true,
    password: "TestPassword-2026!",
  });
  return {
    uid,
    email,
    authTime: Math.floor(Date.now() / 1000),
    verified: true,
  };
}
async function fixture() {
  const owner = await identity(),
    tech = await identity(),
    other = await identity();
  const tenant = (await service.createCompany(owner, "Test company")).id;
  const otherTenant = (await service.createCompany(other, "Other company")).id;
  const c = await service.createRecord(
    owner,
    tenant,
    "customers",
    { name: "Jamie", email: "jamie@example.test", phone: "" },
    unique(),
  );
  const p = await service.createRecord(
    owner,
    tenant,
    "properties",
    { customerId: c.id, label: "Home", address: "123 Test Street" },
    unique(),
  );
  const jobs = [];
  for (let i = 0; i < 2; i++)
    jobs.push(
      (
        await service.createRecord(
          owner,
          tenant,
          "jobs",
          { propertyId: p.id, title: `Service ${i}`, date: "2026-10-29" },
          unique(),
        )
      ).id,
    );
  const permissions = {
    "job.read": "assigned",
    "job.update": "assigned",
    "business_note.create": "assigned",
    "business_note.list": "own",
    "service_request.create": "assigned",
  };
  const invite = await service.invite(owner, tenant, {
    name: "Alex",
    email: tech.email,
    permissions,
    jobIds: [jobs[0]],
  });
  await service.acceptInvite(tech, tenant, invite.token);
  return {
    owner,
    tech,
    other,
    tenant,
    otherTenant,
    jobs,
    permissions,
    customer: c.id,
    property: p.id,
  };
}
const proposal = (
  jobId,
  operation = "business_note.create",
  args = {},
  key = unique(),
) => ({
  key,
  conversationId: "test-conversation",
  proposal: {
    operation,
    arguments: {
      jobId,
      ...(operation === "job.update"
        ? { status: "completed" }
        : { text: "Service complete" }),
      ...args,
    },
  },
});
before(async () => {
  rules = await initializeTestEnvironment({
    projectId: "demo-ghostai",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: await readFile("firestore.rules", "utf8"),
    },
  });
});
after(async () => {
  await rules?.cleanup();
});

test("native note persists atomically, duplicate replay has one note, conflicting key rejects", async () => {
  const f = await fixture(),
    payload = proposal(f.jobs[0]);
  const receipts = await Promise.all(
    Array.from({ length: 6 }, () => service.submit(f.tech, f.tenant, payload)),
  );
  assert.ok(
    receipts.every(
      (r) => r.id === receipts[0].id && r.status === "verified_persisted",
    ),
  );
  const notes = await service.org(f.tenant).collection("notes").get();
  assert.equal(notes.size, 1);
  await assert.rejects(
    service.submit(f.tech, f.tenant, {
      ...payload,
      proposal: {
        ...payload.proposal,
        arguments: { jobId: f.jobs[0], text: "different" },
      },
    }),
    /different details/,
  );
});
test("unregistered operations, identity injection and unsupported permissions reject", async () => {
  const f = await fixture();
  for (const payload of [
    { ...proposal(f.jobs[0]), tenantId: f.otherTenant },
    {
      ...proposal(f.jobs[0]),
      proposal: { operation: "shell.exec", arguments: { command: "ls" } },
    },
    proposal(f.jobs[0], "business_note.create", { risk: "READ" }),
  ])
    await assert.rejects(service.submit(f.tech, f.tenant, payload));
  await assert.rejects(
    service.invite(f.owner, f.tenant, {
      name: "Bad",
      email: "bad@example.test",
      permissions: { "shell.exec": "all" },
      jobIds: [],
    }),
  );
});
test("tenant and job assignment scope are enforced on reads and writes", async () => {
  const f = await fixture();
  await assert.rejects(service.state(f.tech, f.otherTenant), /company access/);
  await assert.rejects(
    service.submit(f.tech, f.tenant, proposal(f.jobs[1])),
    /not assigned/,
  );
  await assert.rejects(
    service.submit(f.other, f.tenant, proposal(f.jobs[0])),
    /company access/,
  );
  const state = await service.state(f.tech, f.tenant);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.team.length, 0);
  assert.equal(state.approvals.length, 0);
  assert.equal(state.customers[0].email, undefined);
});
test("technician cannot invite or alter CRM configuration or own grants", async () => {
  const f = await fixture();
  await assert.rejects(
    service.invite(f.tech, f.tenant, {
      name: "Escalation",
      email: "new@example.test",
      permissions: {},
      jobIds: [],
    }),
    /Only an owner/,
  );
  await assert.rejects(
    service.editMember(f.tech, f.tenant, f.tech.uid, {
      name: "Alex",
      active: true,
      permissions: { "job.read": "all" },
      jobIds: [],
    }),
    /Only an owner/,
  );
  await assert.rejects(
    service.createRecord(
      f.tech,
      f.tenant,
      "customers",
      { name: "New", email: "", phone: "" },
      unique(),
    ),
    /Only an owner/,
  );
});
test("invitations are email bound, one time, expiring and revocable", async () => {
  const f = await fixture(),
    newUser = await identity();
  const invite = await service.invite(f.owner, f.tenant, {
    name: "New",
    email: newUser.email,
    permissions: {},
    jobIds: [],
  });
  await assert.rejects(
    service.acceptInvite(f.other, f.tenant, invite.token),
    /email address/,
  );
  await service.acceptInvite(newUser, f.tenant, invite.token);
  await assert.rejects(
    service.acceptInvite(newUser, f.tenant, invite.token),
    /no longer/,
  );
  const expired = await service.invite(f.owner, f.tenant, {
    name: "Expired",
    email: f.other.email,
    permissions: {},
    jobIds: [],
  });
  const crypto = await import("node:crypto");
  const hash = crypto.createHash("sha256").update(expired.token).digest("hex");
  await service
    .org(f.tenant)
    .collection("invites")
    .doc(hash)
    .update({ expiresAt: 0 });
  await assert.rejects(
    service.acceptInvite(f.other, f.tenant, expired.token),
    /no longer/,
  );
  const canceled = await service.invite(f.owner, f.tenant, {
    name: "Canceled",
    email: f.other.email,
    permissions: {},
    jobIds: [],
  });
  await service.cancelInvite(
    f.owner,
    f.tenant,
    crypto.createHash("sha256").update(canceled.token).digest("hex"),
  );
  await assert.rejects(
    service.acceptInvite(f.other, f.tenant, canceled.token),
    /no longer/,
  );
});
test("unverified email and stale authentication cannot create companies or accept invites", async () => {
  const user = await identity();
  await assert.rejects(
    service.createCompany({ ...user, verified: false }, "No"),
    /Verify your email/,
  );
  await assert.rejects(
    service.createCompany({ ...user, authTime: 1 }, "No"),
    /sign in again/,
  );
});
test("repair writes require an owner approval and produce one demo record", async () => {
  const f = await fixture(),
    receipt = await service.submit(
      f.tech,
      f.tenant,
      proposal(f.jobs[0], "service_request.create"),
    );
  assert.equal(receipt.status, "pending_confirmation");
  assert.equal(
    (await service.org(f.tenant).collection("requests").get()).size,
    0,
  );
  await assert.rejects(
    service.approve(f.tech, f.tenant, receipt.id, true),
    /Only an owner/,
  );
  const result = await service.approve(f.owner, f.tenant, receipt.id, true);
  assert.equal(result.status, "verified_persisted");
  assert.equal(result.simulated, true);
  await assert.rejects(
    service.approve(f.owner, f.tenant, receipt.id, true),
    /already been resolved/,
  );
  assert.equal(
    (await service.org(f.tenant).collection("requests").get()).size,
    1,
  );
});
test("concurrent owner approval cannot duplicate fake CRM effects", async () => {
  const f = await fixture(),
    receipt = await service.submit(
      f.tech,
      f.tenant,
      proposal(f.jobs[0], "service_request.create"),
    );
  const results = await Promise.allSettled([
    service.approve(f.owner, f.tenant, receipt.id, true),
    service.approve(f.owner, f.tenant, receipt.id, true),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await service.org(f.tenant).collection("requests").get()).size,
    1,
  );
});
test("permission changes, removed assignments and deactivation reject pending work", async () => {
  for (const change of [
    { permissions: {} },
    { jobIds: [] },
    { active: false },
  ]) {
    const f = await fixture(),
      receipt = await service.submit(
        f.tech,
        f.tenant,
        proposal(f.jobs[0], "service_request.create"),
      );
    await service.editMember(f.owner, f.tenant, f.tech.uid, {
      name: "Alex",
      active: true,
      permissions: f.permissions,
      jobIds: [f.jobs[0]],
      ...change,
    });
    assert.equal(
      (await service.approve(f.owner, f.tenant, receipt.id, true)).status,
      "rejected",
    );
    assert.equal(
      (await service.org(f.tenant).collection("requests").get()).size,
      0,
    );
  }
});
test("proposal digest mismatch and expired approvals never write a repair", async () => {
  for (const tampering of [
    { args: { jobId: "foreign", text: "tampered" } },
    { expiresAt: 0 },
  ]) {
    const f = await fixture(),
      receipt = await service.submit(
        f.tech,
        f.tenant,
        proposal(f.jobs[0], "service_request.create"),
      );
    await service
      .org(f.tenant)
      .collection("receipts")
      .doc(receipt.id)
      .update(tampering);
    assert.equal(
      (await service.approve(f.owner, f.tenant, receipt.id, true)).status,
      "rejected",
    );
    assert.equal(
      (await service.org(f.tenant).collection("requests").get()).size,
      0,
    );
  }
});
test("disabled requester cannot have pending request executed", async () => {
  const f = await fixture(),
    receipt = await service.submit(
      f.tech,
      f.tenant,
      proposal(f.jobs[0], "service_request.create"),
    );
  await getAuth().updateUser(f.tech.uid, { disabled: true });
  assert.equal(
    (await service.approve(f.owner, f.tenant, receipt.id, true)).status,
    "rejected",
  );
});
test("own-note scope reduces records immediately, receipts do not leak raw proposals", async () => {
  const f = await fixture();
  await service.submit(
    f.owner,
    f.tenant,
    proposal(f.jobs[0], "business_note.create", { text: "Owner-only note" }),
  );
  await service.submit(f.tech, f.tenant, proposal(f.jobs[0]));
  let state = await service.state(f.tech, f.tenant);
  assert.equal(state.notes.length, 1);
  assert.equal(state.notes[0].authorId, f.tech.uid);
  assert.equal(state.receipts[0].args, undefined);
  assert.equal(state.receipts[0].digest, undefined);
  await service.editMember(f.owner, f.tenant, f.tech.uid, {
    name: "Alex",
    active: true,
    permissions: { "job.read": "assigned" },
    jobIds: [f.jobs[0]],
  });
  state = await service.state(f.tech, f.tenant);
  assert.equal(state.notes.length, 0);
});
test("CRM edits validate ownership and preserve job status", async () => {
  const f = await fixture();
  await service.updateRecord(f.owner, f.tenant, "customers", f.customer, {
    name: "Updated",
    email: "",
    phone: "555",
  });
  await service.submit(f.tech, f.tenant, proposal(f.jobs[0], "job.update"));
  await service.updateRecord(f.owner, f.tenant, "jobs", f.jobs[0], {
    propertyId: f.property,
    title: "New title",
    date: "2026-11-01",
  });
  const state = await service.state(f.owner, f.tenant);
  assert.equal(state.jobs.find((j) => j.id === f.jobs[0]).status, "completed");
  assert.equal(state.customers[0].name, "Updated");
  await assert.rejects(
    service.updateRecord(f.owner, f.tenant, "properties", f.property, {
      customerId: "foreign",
      label: "x",
      address: "x",
    }),
    /Customer not found/,
  );
});
test("owner can resolve a repair while technician cannot", async () => {
  const f = await fixture(),
    receipt = await service.submit(
      f.tech,
      f.tenant,
      proposal(f.jobs[0], "service_request.create"),
    );
  await service.approve(f.owner, f.tenant, receipt.id, true);
  await assert.rejects(
    service.resolveRepair(f.tech, f.tenant, receipt.id),
    /Only an owner/,
  );
  await service.resolveRepair(f.owner, f.tenant, receipt.id);
  assert.equal(
    (await service.state(f.owner, f.tenant)).requests[0].status,
    "resolved",
  );
});
test("browser Firestore reads and writes are denied even with authenticated identity", async () => {
  const f = await fixture(),
    client = rules.authenticatedContext(f.owner.uid).firestore();
  await assertFails(getDoc(doc(client, `organizations/${f.tenant}`)));
  await assertFails(
    setDoc(doc(client, `organizations/${f.tenant}/members/${f.owner.uid}`), {
      role: "owner",
    }),
  );
});
test("real HTTP function verifies ID tokens, input shape, CORS and full workflow", async () => {
  const f = await fixture();
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: f.owner.email,
        password: "TestPassword-2026!",
        returnSecureToken: true,
      }),
    },
  );
  const login = await response.json();
  assert.ok(login.idToken);
  const base = "http://127.0.0.1:5001/demo-ghostai/us-central1/api";
  const headers = {
    Authorization: `Bearer ${login.idToken}`,
    "Content-Type": "application/json",
  };
  assert.equal((await fetch(`${base}/me`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/me`, {
        headers: { ...headers, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${base}/orgs/${f.tenant}/state`, { headers })).status,
    200,
  );
  const create = await fetch(`${base}/orgs/${f.tenant}/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      key: unique(),
      data: { name: "HTTP customer", email: "", phone: "" },
    }),
  });
  assert.equal(create.status, 200);
  const invalid = await fetch(`${base}/orgs/${f.tenant}/operations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...proposal(f.jobs[0]), tenantId: "other" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    (await fetch(`${base}/orgs/${f.tenant}/connections/openai`, { headers }))
      .status,
    200,
  );
  const revokeInjection = await fetch(`${base}/account/revoke-sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ uid: f.other.uid }),
  });
  assert.equal(revokeInjection.status, 400);
  const revoke = await fetch(`${base}/account/revoke-sessions`, {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(revoke.status, 200);
});

test("credential encryption is tenant bound and never returns stored keys", async () => {
  const {
    Credentials,
    encryptKey,
    decryptKey,
  } = require("../lib/credentials.js");
  const f = await fixture(),
    master = Buffer.alloc(32, 7).toString("base64"),
    key = "sk-test-fixture-key-not-a-real-provider-key";
  const sealed = encryptKey(key, master, f.tenant);
  assert.equal(decryptKey(sealed, master, f.tenant), key);
  assert.throws(() => decryptKey(sealed, master, f.otherTenant));
  assert.throws(() =>
    decryptKey(
      { ...sealed, tag: Buffer.alloc(16).toString("base64") },
      master,
      f.tenant,
    ),
  );
  let validations = 0;
  const vault = new Credentials(
    service,
    () => master,
    async (value) => {
      assert.equal(value, key);
      validations++;
    },
  );
  await assert.rejects(
    vault.connect(f.tech, f.tenant, { key }),
    /Only an owner/,
  );
  await assert.rejects(
    vault.connect(f.other, f.tenant, { key }),
    /company access/,
  );
  assert.equal(validations, 0);
  const status = await vault.connect(f.owner, f.tenant, { key });
  assert.equal(status.status, "connected");
  assert.equal(JSON.stringify(status).includes(key), false);
  const stored = (await vault.ref(f.tenant).get()).data();
  assert.ok(stored.sealed);
  assert.equal(JSON.stringify(stored).includes(key), false);
  assert.equal(
    JSON.stringify(await service.state(f.owner, f.tenant)).includes(
      "ciphertext",
    ),
    false,
  );
  assert.equal((await vault.check(f.owner, f.tenant)).status, "connected");
  const failed = new Credentials(
    service,
    () => master,
    async () => {
      throw new (require("../lib/contracts.js").AppError)(400, "Key rejected.");
    },
  );
  assert.equal((await failed.check(f.owner, f.tenant)).status, "error");
  await vault.disconnect(f.owner, f.tenant);
  assert.equal((await vault.ref(f.tenant).get()).data().sealed, undefined);
});

test("Executive routes scoped tools through Gateway and replays without repeating generation", async () => {
  const f = await fixture();
  let generations = 0;
  const runtime = new ExecutiveRuntime(
    service,
    fixtureCredentials,
    async (input) => {
      generations++;
      assert.ok(!input.instructions.includes("fixture-only-no-provider"));
      const found = await input.invoke("jobs_search", {
        query: null,
        date: null,
      });
      assert.equal(found.jobs.length, 1);
      assert.equal(found.jobs[0].id, f.jobs[0]);
      await assert.rejects(input.invoke("job_get", { jobId: f.jobs[1] }));
      await assert.rejects(
        input.invoke("note_add", {
          jobId: f.jobs[0],
          text: "Injected",
          tenant: f.otherTenant,
        }),
      );
      const receipt = await input.invoke("note_add", {
        jobId: f.jobs[0],
        text: "Executive saved this note",
      });
      assert.equal(receipt.status, "verified_persisted");
      const duplicate = await input.invoke("note_add", {
        jobId: f.jobs[0],
        text: "Executive saved this note",
      });
      assert.equal(receipt.id, duplicate.id);
      const approval = await input.invoke("repair_request", {
        jobId: f.jobs[0],
        text: "Valve needs repair",
      });
      assert.equal(approval.status, "pending_confirmation");
      const recent = await input.invoke("actions_recent", {});
      assert.equal(recent.receipts.length, 2);
      return {
        text: "Note saved. The repair is awaiting owner approval.",
        inputTokens: 10,
        outputTokens: 10,
        requests: 1,
      };
    },
  );
  const request = {
    conversationId: unique(),
    turnId: unique(),
    message: "Record this visit and request a repair",
  };
  const first = await runtime.turn(f.tech, f.tenant, request);
  assert.equal(first.turns[0].status, "completed");
  assert.equal(first.turns[0].receipts.length, 2);
  assert.equal(
    (await runtime.turn(f.tech, f.tenant, request)).turns[0].reply,
    first.turns[0].reply,
  );
  assert.equal(generations, 1);
  assert.equal((await service.org(f.tenant).collection("notes").get()).size, 1);
  assert.equal(
    (await service.org(f.tenant).collection("requests").get()).size,
    0,
  );
  await assert.rejects(
    runtime.turn(f.tech, f.tenant, { ...request, message: "Different" }),
  );
  await assert.rejects(
    runtime.history(f.other, f.tenant, request.conversationId),
  );
  assert.deepEqual(
    (await runtime.history(f.owner, f.tenant, request.conversationId)).turns,
    [],
  );
});

test("Executive preserves action receipts after inference failure and blocks concurrent turns", async () => {
  const f = await fixture();
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const runtime = new ExecutiveRuntime(
    service,
    fixtureCredentials,
    async (input) => {
      await input.invoke("note_add", {
        jobId: f.jobs[0],
        text: "Saved before provider interruption",
      });
      entered();
      await gate;
      throw new Error("Provider interrupted");
    },
  );
  const request = {
    conversationId: unique(),
    turnId: unique(),
    message: "Add a note",
  };
  const pending = runtime.turn(f.tech, f.tenant, request);
  await started;
  await assert.rejects(
    runtime.turn(f.tech, f.tenant, { ...request, turnId: unique() }),
    /finishing another/,
  );
  release();
  const response = await pending;
  assert.equal(response.turns[0].status, "failed");
  assert.equal(response.turns[0].receipts[0].status, "verified_persisted");
  await runtime.turn(f.tech, f.tenant, request);
  assert.equal((await service.org(f.tenant).collection("notes").get()).size, 1);
});

test("Executive drops stale context and denies tools after permission changes", async () => {
  const f = await fixture();
  const runtime = new ExecutiveRuntime(
    service,
    fixtureCredentials,
    async (input) => {
      await service.editMember(f.owner, f.tenant, f.tech.uid, {
        name: "Alex",
        active: true,
        permissions: {},
        jobIds: [],
      });
      await assert.rejects(
        input.invoke("job_get", { jobId: f.jobs[0] }),
        /permissions changed/,
      );
      return {
        text: "Stale private response",
        inputTokens: 0,
        outputTokens: 0,
        requests: 1,
      };
    },
  );
  const request = {
    conversationId: unique(),
    turnId: unique(),
    message: "Read my jobs",
  };
  const response = await runtime.turn(f.tech, f.tenant, request);
  assert.deepEqual(response.turns, []);
  assert.deepEqual((await runtime.ready(f.tech, f.tenant)).tools, []);
  assert.equal((await service.org(f.tenant).collection("notes").get()).size, 0);
});

test("SMS consent is self-service, versioned, optional, and never verifies a phone", async () => {
  const { MessagingConsent } = require("../lib/messaging.js");
  const policy = require("../lib/messaging-policy.json");
  const messaging = new MessagingConsent(service),
    f = await fixture();
  const request = {
    action: "opt_in",
    key: unique(),
    phone: "+16025550123",
    version: policy.version,
    agreed: true,
    expectedRevision: 0,
  };
  assert.equal(
    (await messaging.status(f.tech, f.tenant)).status,
    "not_enrolled",
  );
  await assert.rejects(
    messaging.save(f.tech, f.tenant, { ...request, agreed: false }, null),
  );
  await assert.rejects(messaging.save(f.tech, f.otherTenant, request, null));
  await assert.rejects(
    messaging.save(
      f.owner,
      f.tenant,
      { ...request, actorId: f.tech.uid },
      null,
    ),
  );
  const saved = await messaging.save(
    f.tech,
    f.tenant,
    request,
    "http://localhost:3000",
  );
  assert.equal(saved.status, "consented_pending_verification");
  assert.equal(saved.phoneVerified, false);
  assert.equal(saved.smsEnabled, false);
  const ref = service
    .org(f.tenant)
    .collection("messagingConsents")
    .doc(f.tech.uid);
  const evidence = (
    await ref.collection("events").doc(request.key).get()
  ).data();
  assert.equal(evidence.actorId, f.tech.uid);
  assert.equal(evidence.disclosure, policy.disclosure);
  assert.equal(evidence.sourcePath, "/sms");
  assert.equal(evidence.affirmativeCheckbox, true);
  await messaging.save(f.tech, f.tenant, request, "http://localhost:3000");
  assert.equal((await ref.collection("events").get()).size, 1);
  await assert.rejects(
    messaging.save(
      f.tech,
      f.tenant,
      { ...request, key: unique(), phone: "+16025550124" },
      null,
    ),
    /preferences changed/,
  );
  const withdrawn = await messaging.save(
    f.tech,
    f.tenant,
    { action: "withdraw", key: unique(), expectedRevision: 1 },
    null,
  );
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(
    (await messaging.save(f.tech, f.tenant, request, null)).status,
    "withdrawn",
  );
  assert.equal((await ref.collection("events").get()).size, 2);
  assert.equal(
    (await messaging.status(f.owner, f.tenant)).status,
    "not_enrolled",
  );
});

test("Executive full CRM creates linked customer property job and note with durable receipts", async () => {
  const f = await fixture();
  let created,
    generations = 0;
  const runtime = new ExecutiveRuntime(
    service,
    fixtureCredentials,
    async (input) => {
      generations++;
      const customer = await input.invoke("customer_create", {
        name: "Agent New Customer",
        email: null,
        phone: null,
        allowDuplicate: false,
      });
      const property = await input.invoke("property_create", {
        customerId: customer.recordId,
        address: "500 New Service Road",
        label: null,
        allowDuplicate: false,
      });
      const job = await input.invoke("job_create", {
        propertyId: property.recordId,
        title: "First service",
        date: "2026-11-01",
        allowDuplicate: false,
      });
      const note = await input.invoke("note_add", {
        jobId: job.recordId,
        text: "Customer requested weekly service.",
      });
      const read = await input.invoke("crm_get", {
        resource: "customers",
        recordId: customer.recordId,
      });
      assert.equal(read.record.revision, 1);
      assert.equal(read.record.email, "");
      assert.equal(read.record.phone, "");
      created = { customer, property, job, note };
      return {
        text: "Customer, property, job and note saved.",
        inputTokens: 0,
        outputTokens: 0,
        requests: 1,
      };
    },
  );
  const request = {
    conversationId: unique(),
    turnId: unique(),
    message: "Create the new customer, property, job and note",
  };
  const result = await runtime.turn(f.owner, f.tenant, request);
  assert.equal(result.turns[0].status, "completed");
  assert.equal(result.turns[0].receipts.length, 4);
  assert.ok(
    result.turns[0].receipts.every((r) => r.status === "verified_persisted"),
  );
  await runtime.turn(f.owner, f.tenant, request);
  assert.equal(generations, 1);
  const state = await service.state(f.owner, f.tenant);
  assert.equal(
    state.customers.find((c) => c.id === created.customer.recordId).name,
    "Agent New Customer",
  );
  assert.equal(
    state.properties.find((p) => p.id === created.property.recordId).customerId,
    created.customer.recordId,
  );
  assert.equal(
    state.jobs.find((j) => j.id === created.job.recordId).propertyId,
    created.property.recordId,
  );
  assert.equal(
    state.notes.find((n) => n.id === created.note.recordId).jobId,
    created.job.recordId,
  );
  assert.ok(
    (await runtime.ready(f.owner, f.tenant)).tools.some(
      (t) => t.name === "customer_create",
    ),
  );
  assert.ok(
    !(await runtime.ready(f.tech, f.tenant)).tools.some(
      (t) => t.name === "customer_create",
    ),
  );
});

test("Executive full CRM enforces isolation duplicates revisions and reversible dependent archives", async () => {
  const { CRM } = require("../lib/crm.js");
  const crm = new CRM(service),
    f = await fixture(),
    conversation = unique();
  const staleTarget = await service.submit(f.owner, f.tenant, {
    key: unique(),
    conversationId: conversation,
    proposal: {
      operation: "service_request.create",
      arguments: {
        jobId: f.jobs[0],
        text: "Repair proposed for the original visit",
      },
    },
  });
  await service.updateRecord(f.owner, f.tenant, "jobs", f.jobs[0], {
    propertyId: f.property,
    title: "Changed visit",
    date: "2026-11-05",
  });
  const staleDecision = await service.approve(
    f.owner,
    f.tenant,
    staleTarget.id,
    true,
  );
  assert.equal(staleDecision.status, "rejected");
  assert.match(staleDecision.message, /Job details changed/);
  const write = (
    name,
    args,
    key = unique(),
    identity = f.owner,
    tenant = f.tenant,
  ) => crm.write(identity, tenant, name, args, key, conversation);
  const create = {
    name: "New CRM Customer",
    email: "new-crm@example.test",
    phone: null,
    allowDuplicate: false,
  };
  const key = unique(),
    customer = await write("customer_create", create, key);
  assert.equal((await write("customer_create", create, key)).id, customer.id);
  await assert.rejects(
    write("customer_create", { ...create, name: "new crm customer" }),
    /matching record/,
  );
  await assert.rejects(
    write("customer_create", create, unique(), f.tech),
    /Only an owner/,
  );
  await assert.rejects(
    write("customer_create", create, unique(), f.other),
    /company access/,
  );
  await assert.rejects(
    crm.read(f.tech, f.tenant, "crm_search", {
      resource: "customers",
      query: null,
      includeArchived: false,
      cursor: null,
    }),
    /Only an owner/,
  );
  const property = await write("property_create", {
    customerId: customer.recordId,
    address: "501 CRM Lane",
    label: "Home",
    allowDuplicate: false,
  });
  const job = await write("job_create", {
    propertyId: property.recordId,
    title: "Visit",
    date: "2026-11-01",
    allowDuplicate: false,
  });
  const foreign = await service.createRecord(
    f.other,
    f.otherTenant,
    "customers",
    { name: "Foreign", email: "", phone: "" },
    unique(),
  );
  await assert.rejects(
    write("property_create", {
      customerId: foreign.id,
      address: "501 CRM Lane",
      label: null,
      allowDuplicate: false,
    }),
    /linked record/,
  );
  await service.updateRecord(
    f.owner,
    f.tenant,
    "customers",
    customer.recordId,
    { name: create.name, email: create.email, phone: "6025550123" },
  );
  await assert.rejects(
    write("customer_update", {
      recordId: customer.recordId,
      expectedRevision: 1,
      name: "Stale overwrite",
      email: null,
      phone: null,
    }),
    /record changed/,
  );
  const changed = await write("customer_update", {
    recordId: customer.recordId,
    expectedRevision: 2,
    name: "Updated customer",
    email: null,
    phone: null,
  });
  assert.equal(changed.record.name, "Updated customer");
  assert.equal(changed.record.phone, "6025550123");
  const moved = await write("property_update", {
    recordId: property.recordId,
    expectedRevision: 1,
    customerId: null,
    address: "502 CRM Lane",
    label: null,
  });
  assert.equal(moved.record.address, "502 CRM Lane");
  const editedJob = await write("job_edit", {
    recordId: job.recordId,
    expectedRevision: 1,
    propertyId: null,
    title: null,
    date: "2026-11-02",
    status: "in_progress",
  });
  assert.equal(editedJob.record.date, "2026-11-02");
  const note = await service.submit(f.owner, f.tenant, {
    key: unique(),
    conversationId: conversation,
    proposal: {
      operation: "business_note.create",
      arguments: { jobId: job.recordId, text: "Original note" },
    },
  });
  assert.equal(
    (
      await write("note_update", {
        recordId: note.recordId,
        expectedRevision: 1,
        text: "Corrected note",
      })
    ).record.text,
    "Corrected note",
  );
  const repair = await service.submit(f.owner, f.tenant, {
    key: unique(),
    conversationId: conversation,
    proposal: {
      operation: "service_request.create",
      arguments: { jobId: job.recordId, text: "Repair needed" },
    },
  });
  await service.approve(f.owner, f.tenant, repair.id, true);
  assert.equal(
    (
      await write("repair_update", {
        recordId: repair.id,
        expectedRevision: 1,
        text: "Valve repair",
      })
    ).record.text,
    "Valve repair",
  );
  assert.equal(
    (
      await write("repair_resolve", {
        recordId: repair.id,
        expectedRevision: 2,
      })
    ).record.status,
    "resolved",
  );
  const archive = (resource, recordId, expectedRevision, archived = true) =>
    write("record_archive", { resource, recordId, expectedRevision, archived });
  await assert.rejects(
    archive("customers", customer.recordId, 3),
    /child records/,
  );
  await assert.rejects(
    archive("properties", property.recordId, 2),
    /child records/,
  );
  const pending = await service.submit(f.owner, f.tenant, {
    key: unique(),
    conversationId: conversation,
    proposal: {
      operation: "service_request.create",
      arguments: { jobId: job.recordId, text: "Pending before archive" },
    },
  });
  await archive("jobs", job.recordId, 2);
  await assert.rejects(
    service.submit(f.owner, f.tenant, {
      key: unique(),
      conversationId: conversation,
      proposal: {
        operation: "business_note.create",
        arguments: { jobId: job.recordId, text: "Blocked" },
      },
    }),
    /archived/,
  );
  assert.equal(
    (await service.approve(f.owner, f.tenant, pending.id, true)).status,
    "rejected",
  );
  assert.ok(
    !(await service.state(f.owner, f.tenant)).jobs.some(
      (j) => j.id === job.recordId,
    ),
  );
  await archive("properties", property.recordId, 2);
  await archive("customers", customer.recordId, 3);
  await assert.rejects(
    archive("jobs", job.recordId, 3, false),
    /linked record/,
  );
  await archive("customers", customer.recordId, 4, false);
  await archive("properties", property.recordId, 3, false);
  await archive("jobs", job.recordId, 3, false);
  const restored = await service.state(f.owner, f.tenant);
  assert.ok(restored.jobs.some((j) => j.id === job.recordId));
  assert.equal(
    restored.notes.find((n) => n.id === note.recordId).text,
    "Corrected note",
  );
  assert.equal(
    restored.requests.find((r) => r.id === repair.id).status,
    "resolved",
  );
  await archive("notes", note.recordId, 2);
  assert.ok(
    !(await service.state(f.owner, f.tenant)).notes.some(
      (n) => n.id === note.recordId,
    ),
  );
  await archive("notes", note.recordId, 3, false);
});

// Only creates synthetic data in the explicitly named local emulators.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "node:module";
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== "demo-ghostai")
  throw new Error("Demo seed is restricted to demo-ghostai.");
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
initializeApp({ projectId: "demo-ghostai" });
const require = createRequire(import.meta.url);
const { Service } = require("../functions/lib/service.js");
const service = new Service(getFirestore()),
  auth = getAuth();
async function account(uid, email, name) {
  try {
    await auth.getUser(uid);
  } catch {
    await auth.createUser({
      uid,
      email,
      displayName: name,
      password: "DemoOnly-2026!",
      emailVerified: true,
    });
  }
  return {
    uid,
    email,
    authTime: Math.floor(Date.now() / 1000),
    verified: true,
  };
}
const owner = await account("demo-owner", "owner@demo.ghostai.test", "Morgan");
const tech = await account("demo-technician", "alex@demo.ghostai.test", "Alex");
const { id: tenant } = await service.createCompany(owner, "Desert Pool Care");
await service.member(tenant, owner.uid).update({ name: "Morgan" });
const today = new Date().toLocaleDateString("en-CA");
const customers = [
  [
    "Jamie Johnson",
    "jamie@example.test",
    "(602) 555-0142",
    "Desert Ridge home",
    "1234 E Desert Ridge Road, Phoenix, AZ",
    "Weekly pool service",
    "scheduled",
  ],
  [
    "Sarah Martinez",
    "sarah@example.test",
    "(480) 555-0168",
    "Scottsdale residence",
    "2218 N Palo Verde Lane, Scottsdale, AZ",
    "Filter inspection & clean",
    "in_progress",
  ],
  [
    "David Chen",
    "david@example.test",
    "(602) 555-0126",
    "Arcadia home",
    "873 W Citrus Avenue, Phoenix, AZ",
    "Pool equipment check",
    "scheduled",
  ],
  [
    "Emma Williams",
    "emma@example.test",
    "(480) 555-0181",
    "Tempe rental",
    "420 S Maple Drive, Tempe, AZ",
    "Weekly pool service",
    "completed",
  ],
];
const jobIds = [];
for (const [
  index,
  [name, email, phone, label, address, title, status],
] of customers.entries()) {
  const customer = await service.createRecord(
    owner,
    tenant,
    "customers",
    { name, email, phone },
    `seed-customer-${index}`,
  );
  const property = await service.createRecord(
    owner,
    tenant,
    "properties",
    { customerId: customer.id, label, address },
    `seed-property-${index}`,
  );
  const job = await service.createRecord(
    owner,
    tenant,
    "jobs",
    { propertyId: property.id, title, date: today },
    `seed-job-${index}`,
  );
  jobIds.push(job.id);
  await service.org(tenant).collection("jobs").doc(job.id).update({ status });
}
const member = await service.member(tenant, tech.uid).get();
if (!member.exists) {
  const invite = await service.invite(owner, tenant, {
    name: "Alex Rivera",
    email: tech.email,
    permissions: {
      "job.read": "assigned",
      "job.update": "assigned",
      "business_note.create": "assigned",
      "business_note.list": "assigned",
      "service_request.create": "assigned",
    },
    jobIds: jobIds.slice(0, 3),
  });
  await service.acceptInvite(tech, tenant, invite.token);
}
for (const [index, jobId] of jobIds.entries()) {
  await service.submit(owner, tenant, {
    key: `seed-note-${index}`,
    conversationId: "seed-owner",
    proposal: {
      operation: "business_note.create",
      arguments: {
        jobId,
        text: [
          "Skimmed surface and checked chemistry. Water is clear; keep an eye on the return valve next visit.",
          "Pressure running higher than usual. Filter due for a full rinse.",
          "Equipment is running well. Customer asked about replacing the timer.",
          "Routine service completed. Chemistry balanced and baskets emptied.",
        ][index],
      },
    },
  });
}
await service.submit(tech, tenant, {
  key: "seed-repair",
  conversationId: "seed-tech",
  proposal: {
    operation: "service_request.create",
    arguments: {
      jobId: jobIds[0],
      text: "Small leak at the return valve. Recommend replacing the seal before the next scheduled service.",
    },
  },
});
console.log(
  "Local demo is ready. Open http://127.0.0.1:3000 and choose Open demo workspace.",
);
console.log(
  "Owner: owner@demo.ghostai.test | Technician: alex@demo.ghostai.test | Password: DemoOnly-2026!",
);

// Assisted onboarding, run by an operator with Firebase/Secret Manager ADC access.
// Input is a private JSON file, never command-line credentials or browser fields.
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { GoogleAuth } = require("google-auth-library");
const { Service } = require("../functions/lib/service.js");
const { Sms } = require("../functions/lib/sms.js");
const [tenant, inputPath] = process.argv.slice(2);
if (!tenant || !inputPath)
  throw new Error(
    "Usage: npm run setup:twilio -- COMPANY_ID /absolute/path/private-twilio.json",
  );
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR)
  throw new Error("Unset emulator variables before live onboarding.");
const file = await stat(inputPath);
if ((file.mode & 0o077) !== 0)
  throw new Error(
    "Credentials file must be private: chmod 600 on the file first.",
  );
const project = "ghostai-794c5";
process.env.GCLOUD_PROJECT = project;
initializeApp({ projectId: project, credential: applicationDefault() });
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
try {
  const client = await auth.getClient();
  const credentials = await auth.getCredentials();
  const secret = await client.request({
    url: `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/GHOSTAI_VAULT_KEY/versions/latest:access`,
  });
  const master = Buffer.from(secret.data.payload.data, "base64")
    .toString("utf8")
    .trim();
  const sms = new Sms(new Service(getFirestore()), () => master);
  const result = await sms.configure(
    tenant,
    JSON.parse(await readFile(inputPath, "utf8")),
    `onboarding:${credentials.client_email ?? "ADC-operator"}`,
  );
  console.log(JSON.stringify(result, null, 2));
} catch {
  // Provider SDK errors can contain account credentials/request details. Do not print them.
  console.error(
    "Twilio setup failed. Confirm ADC permissions, company ID, account credentials, and ownership of an SMS-capable number. Connection stays disabled if provider configuration did not finish.",
  );
  process.exitCode = 1;
}

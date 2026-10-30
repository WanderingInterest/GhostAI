// This is the explicit deployment boundary. Run it yourself when ready.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);
const firebase = require("firebase-tools");
const project = "ghostai-794c5",
  name = "GHOSTAI_VAULT_KEY";
if (
  process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  process.env.FUNCTIONS_EMULATOR
)
  throw new Error(
    "Unset emulator environment variables before deploying the live backend.",
  );
const config = JSON.parse(await readFile(resolve(".firebaserc"), "utf8"));
if (config.projects?.default !== project)
  throw new Error("Unexpected Firebase project. Deployment stopped.");
console.log(
  `Preparing backend deployment to ${project}. No frontend will be deployed.`,
);
try {
  const existing = await firebase.functions.secrets.get(name, {
    project,
    nonInteractive: true,
  });
  if (!existing.secrets?.some((version) => version.state === "ENABLED"))
    throw new Error(
      "The existing vault key has no enabled version. Restore it; do not replace a key that protects existing credentials.",
    );
  console.log("Keeping the existing vault encryption key.");
} catch (error) {
  if (error.status !== 404) throw error;
  const directory = await mkdtemp(join(tmpdir(), "ghostai-vault-"));
  const path = join(directory, "key");
  try {
    await writeFile(path, randomBytes(32).toString("base64"), {
      mode: 0o600,
      flag: "wx",
    });
    await firebase.functions.secrets.set(name, {
      project,
      dataFile: path,
      nonInteractive: true,
    });
    console.log("Created the vault encryption key in Firebase Secret Manager.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
await firebase.deploy({
  project,
  only: "functions:api,firestore:rules,firestore:indexes",
  config: "firebase.json",
});
console.log(
  "Backend deployed. Start npm run dev:live to use real Firebase locally.",
);

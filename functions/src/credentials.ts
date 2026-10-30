import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { Service } from "./service";
import { AppError, assert, Identity, id } from "./contracts";

export type SealedKey = {
  ciphertext: string;
  iv: string;
  tag: string;
  format: 1;
};
export type Connection = {
  status: "connected" | "disconnected" | "error";
  lastCheckedAt: number | null;
  updatedAt: number | null;
  message: string | null;
};
const context = (tenant: string, provider: string) =>
  `ghostai:v1:${tenant}:${provider}`;
export function encryptKey(
  key: string,
  master: string,
  tenant: string,
  provider = "openai",
): SealedKey {
  id.parse(tenant);
  const bytes = Buffer.from(master, "base64");
  assert(bytes.length === 32, "Credential storage is not configured.", 503);
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", bytes, iv);
  cipher.setAAD(Buffer.from(context(tenant, provider)));
  const encrypted = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return {
    format: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}
export function decryptKey(
  value: SealedKey,
  master: string,
  tenant: string,
  provider = "openai",
): string {
  id.parse(tenant);
  assert(value.format === 1, "Credential format is unsupported.", 503);
  const bytes = Buffer.from(master, "base64");
  assert(bytes.length === 32, "Credential storage is not configured.", 503);
  const cipher = createDecipheriv(
    "aes-256-gcm",
    bytes,
    Buffer.from(value.iv, "base64"),
  );
  cipher.setAAD(Buffer.from(context(tenant, provider)));
  cipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(value.ciphertext, "base64")),
    cipher.final(),
  ]).toString("utf8");
}
// No generation, customer data, model names or provider error payloads are logged.
export async function validateOpenAI(key: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
  } catch {
    throw new AppError(
      502,
      "OpenAI could not be reached. Try again in a moment.",
    );
  }
  if (response.body) await response.body.cancel();
  if (response.status === 401)
    throw new AppError(
      400,
      "OpenAI rejected this key. Check that it is active and try again.",
    );
  if (response.status === 403)
    throw new AppError(
      400,
      "This key needs permission to list models so GhostAI can validate it.",
    );
  if (response.status === 429)
    throw new AppError(
      429,
      "OpenAI is limiting requests. Please try again later.",
    );
  assert(
    response.ok,
    "OpenAI could not validate this key. Try again later.",
    502,
  );
}
const inputSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(20)
      .max(1024)
      .regex(/^sk-[A-Za-z0-9_-]+$/),
  })
  .strict();
export class Credentials {
  constructor(
    private service: Service,
    private master: () => string,
    private validate: (key: string) => Promise<void> = validateOpenAI,
  ) {}
  private localKey(tenant: string): string | undefined {
    // A development key is only available to the seeded local company. It is
    // never stored in emulator Firestore or accepted in production.
    const demoTenant = createHash("sha256")
      .update("owner:demo-owner")
      .digest("hex")
      .slice(0, 32);
    return process.env.FUNCTIONS_EMULATOR === "true" &&
      process.env.GCLOUD_PROJECT === "demo-ghostai" &&
      tenant === demoTenant
      ? process.env.GHOSTAI_LOCAL_OPENAI_KEY
      : undefined;
  }
  async runtimeAvailable(identity: Identity, tenant: string): Promise<boolean> {
    return this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid);
      if (this.localKey(tenant)) return true;
      const connection = await tx.get(this.ref(tenant));
      return (
        process.env.FUNCTIONS_EMULATOR !== "true" &&
        Boolean(connection.data()?.sealed)
      );
    });
  }
  async runtimeKey(identity: Identity, tenant: string): Promise<string> {
    return this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid);
      const local = this.localKey(tenant);
      if (local) return local;
      assert(
        process.env.FUNCTIONS_EMULATOR !== "true",
        "Configure the local assistant key first.",
        503,
      );
      const connection = await tx.get(this.ref(tenant));
      assert(
        connection.data()?.sealed,
        "Ask your owner to connect OpenAI in Connections.",
        400,
      );
      return decryptKey(connection.data()!.sealed, this.master(), tenant);
    });
  }
  ref(tenant: string) {
    return this.service
      .org(tenant)
      .collection("privateCredentials")
      .doc("openai");
  }
  async status(identity: Identity, tenant: string): Promise<Connection> {
    return this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid, true);
      const snapshot = await tx.get(this.ref(tenant)),
        data = snapshot.data();
      return {
        status: data?.status ?? "disconnected",
        lastCheckedAt: data?.lastCheckedAt ?? null,
        updatedAt: data?.updatedAt ?? null,
        message: data?.message ?? null,
      };
    });
  }
  async connect(
    identity: Identity,
    tenant: string,
    input: unknown,
  ): Promise<Connection> {
    this.service.recent(identity);
    const { key } = inputSchema.parse(input);
    await this.service.db.runTransaction((tx) =>
      this.service.membership(tx, tenant, identity.uid, true),
    );
    await this.validate(key);
    const sealed = encryptKey(key, this.master(), tenant),
      at = Date.now();
    await this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid, true);
      tx.set(this.ref(tenant), {
        sealed,
        status: "connected",
        updatedAt: at,
        lastCheckedAt: at,
        message: null,
      });
      this.service.audit(
        tx,
        tenant,
        identity.uid,
        "connection.saved",
        "openai",
      );
    });
    return {
      status: "connected",
      lastCheckedAt: at,
      updatedAt: at,
      message: null,
    };
  }
  async check(identity: Identity, tenant: string): Promise<Connection> {
    this.service.recent(identity);
    const current = await this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid, true);
      const snapshot = await tx.get(this.ref(tenant));
      const data = snapshot.data();
      assert(data?.sealed, "Connect your OpenAI project first.", 400);
      return data;
    });
    // Detect rotation/disconnect while provider validation was in flight.
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(current.sealed))
      .digest("hex");
    let message: string | null = null;
    try {
      await this.validate(decryptKey(current.sealed, this.master(), tenant));
    } catch (error) {
      if (error instanceof AppError) message = error.message;
      else message = "This connection needs a new key.";
    }
    const at = Date.now();
    return this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid, true);
      const snapshot = await tx.get(this.ref(tenant)),
        data = snapshot.data();
      assert(
        data?.sealed &&
          createHash("sha256")
            .update(JSON.stringify(data.sealed))
            .digest("hex") === fingerprint,
        "Connection changed. Refresh and try again.",
        409,
      );
      tx.update(this.ref(tenant), {
        status: message ? "error" : "connected",
        lastCheckedAt: at,
        message,
      });
      this.service.audit(
        tx,
        tenant,
        identity.uid,
        "connection.checked",
        "openai",
      );
      return {
        status: message ? "error" : "connected",
        lastCheckedAt: at,
        updatedAt: data.updatedAt,
        message,
      };
    });
  }
  async disconnect(identity: Identity, tenant: string): Promise<Connection> {
    this.service.recent(identity);
    const at = Date.now();
    await this.service.db.runTransaction(async (tx) => {
      await this.service.membership(tx, tenant, identity.uid, true);
      tx.set(this.ref(tenant), {
        status: "disconnected",
        updatedAt: at,
        lastCheckedAt: null,
        message: null,
      });
      this.service.audit(
        tx,
        tenant,
        identity.uid,
        "connection.disconnected",
        "openai",
      );
    });
    return {
      status: "disconnected",
      lastCheckedAt: null,
      updatedAt: at,
      message: null,
    };
  }
}

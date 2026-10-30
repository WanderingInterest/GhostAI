"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { api, emulator } from "@/lib/firebase";
type Connection = {
  status: "connected" | "disconnected" | "error";
  lastCheckedAt: number | null;
  updatedAt: number | null;
  message: string | null;
};
export function Connections({
  tenant,
  busy,
  run,
  onError,
  onNotice,
}: {
  tenant: string;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onError: (e: unknown) => void;
  onNotice: (message: string) => void;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [replacing, setReplacing] = useState(false);
  const path = `/orgs/${tenant}/connections/openai`;
  useEffect(() => {
    let current = true;
    setConnection(null);
    setReplacing(false);
    api<Connection>(path)
      .then((value) => {
        if (current) setConnection(value);
      })
      .catch(onError);
    return () => {
      current = false;
    };
  }, [path, onError]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      key = String(new FormData(form).get("key"));
    await run(async () => {
      const next = await api<Connection>(path, { key });
      setConnection(next);
      form.reset();
      setReplacing(false);
      onNotice("OpenAI connected.");
    });
  }
  const connected = connection && connection.status !== "disconnected";
  return (
    <>
      <TwilioConnection
        key={tenant}
        tenant={tenant}
        onError={onError}
        busy={busy}
        run={run}
        onNotice={onNotice}
      />
      <section className="panel connection-panel">
        <div className="panel-heading">
          <div className="connection-heading">
            <span className="empty-icon">
              <KeyRound size={22} />
            </span>
            <div>
              <h2>OpenAI</h2>
              <p>Your company’s AI project, paid directly to OpenAI.</p>
            </div>
          </div>
          <span
            className={`pill ${connection?.status === "connected" ? "completed" : connection?.status === "error" ? "scheduled" : ""}`}
          >
            {!connection
              ? "Loading…"
              : connection.status === "connected"
                ? "Connected"
                : connection.status === "error"
                  ? "Needs attention"
                  : "Not connected"}
          </span>
        </div>
        <div className="connection-body">
          {emulator ? (
            <div className="form-notice">
              Connections are available in your live workspace after the backend
              is deployed. No provider keys are collected in this local preview.
            </div>
          ) : !connection ? (
            <p className="helper">
              <LoaderCircle size={15} className="spin" /> Checking connection…
            </p>
          ) : (
            <>
              {connection.message && (
                <div className="alert error" role="alert">
                  {connection.message}
                </div>
              )}
              {connected && !replacing ? (
                <>
                  <p>Your key is securely stored and never shown again.</p>
                  {connection.lastCheckedAt && (
                    <small className="helper">
                      Last checked{" "}
                      {new Date(connection.lastCheckedAt).toLocaleString()}
                    </small>
                  )}
                  <div className="connection-actions">
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const next = await api<Connection>(
                            `${path}/check`,
                            {},
                          );
                          setConnection(next);
                          onNotice(
                            next.status === "connected"
                              ? "Connection is working."
                              : "Connection needs attention.",
                          );
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      Check connection
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setReplacing(true)}
                    >
                      Replace key
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          setConnection(
                            await api<Connection>(`${path}/disconnect`, {}),
                          );
                          onNotice("OpenAI disconnected.");
                        })
                      }
                    >
                      <Unplug size={15} />
                      Disconnect
                    </button>
                  </div>
                  <p className="helper">
                    Disconnecting removes GhostAI’s stored key. Revoke the key
                    in OpenAI too if you want to disable it everywhere.
                  </p>
                </>
              ) : (
                <form onSubmit={save}>
                  <FieldHelp />
                  <label className="field">
                    <span>{connected ? "New API key" : "Project API key"}</span>
                    <input
                      name="key"
                      type="password"
                      required
                      minLength={20}
                      maxLength={1024}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk-…"
                    />
                    <small>
                      The key needs model-list read access for validation. This
                      checks access without generating content.
                    </small>
                  </label>
                  <div className="connection-actions">
                    <button
                      className="button primary"
                      disabled={busy}
                      type="submit"
                    >
                      {busy && <LoaderCircle size={15} className="spin" />}
                      {connected ? "Replace and validate" : "Connect OpenAI"}
                    </button>
                    {connected && (
                      <button
                        className="button secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => setReplacing(false)}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
function FieldHelp() {
  return (
    <p className="connection-help">
      Create a dedicated key in your OpenAI project, then connect it here.{" "}
      <a
        href="https://platform.openai.com/api-keys"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open API keys <ExternalLink size={12} />
      </a>
    </p>
  );
}

function TwilioConnection({
  tenant,
  onError,
  busy,
  run,
  onNotice,
}: {
  tenant: string;
  onError: (e: unknown) => void;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [connection, setConnection] = useState<{
    status: string;
    phone: string | null;
    sender: string | null;
    supportEmail: string | null;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const path = `/orgs/${tenant}/connections/twilio`;
  useEffect(() => {
    let current = true;
    api<NonNullable<typeof connection>>(path)
      .then((value) => {
        if (current) setConnection(value);
      })
      .catch(onError);
    return () => {
      current = false;
    };
  }, [path, onError]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      fields = new FormData(form);
    const body = {
      accountSid: String(fields.get("accountSid")).trim(),
      authToken: String(fields.get("authToken")).trim(),
      phone: String(fields.get("phone"))
        .trim()
        .replace(/[\s().-]/g, ""),
      sender: String(fields.get("sender")).trim(),
      supportEmail: String(fields.get("supportEmail")).trim(),
      approvedForMessaging: fields.get("approvedForMessaging") === "on",
    };
    await run(async () => {
      const value = await api<NonNullable<typeof connection>>(path, body);
      setConnection(value);
      form.reset();
      setEditing(false);
      onNotice(
        value.status === "connected"
          ? "Twilio connected. Team members can now verify their phones."
          : "Twilio saved. Messaging will stay off until sender approval is confirmed.",
      );
    });
  }
  return (
    <section className="panel connection-panel">
      <div className="panel-heading">
        <div>
          <h2>Text messaging</h2>
          <p>Connect the customer’s Twilio number during onboarding.</p>
        </div>
        <span
          className={`pill ${connection?.status === "connected" ? "completed" : ""}`}
        >
          {!connection
            ? "Loading…"
            : connection.status === "connected"
              ? "Connected"
              : connection.status === "pending"
                ? "Setup pending"
                : "Not connected"}
        </span>
      </div>
      <div className="connection-body">
        {connection?.phone && (
          <p>
            <strong>{connection.phone}</strong>
            {connection.sender ? ` · ${connection.sender}` : ""}
          </p>
        )}
        {emulator ? (
          <p className="form-notice">
            Twilio setup is available in the live workspace. No real credentials
            are collected in the local preview.
          </p>
        ) : !connection ? (
          <p className="helper">Loading connection…</p>
        ) : editing || connection.status === "not_connected" ? (
          <form onSubmit={save}>
            <p>
              Use the customer’s business number and Twilio account credentials.
              We’ll verify the number and configure its connection.
            </p>
            <label className="field">
              <span>Twilio phone number</span>
              <input
                name="phone"
                type="tel"
                autoComplete="off"
                placeholder="+16025550123"
                required
                maxLength={24}
                defaultValue={connection.phone ?? ""}
                readOnly={!!connection.phone}
              />
              <small>
                {connection.phone
                  ? "Disconnect before switching to another number."
                  : "Include the country code."}
              </small>
            </label>
            <label className="field">
              <span>Account SID</span>
              <input
                name="accountSid"
                required
                pattern="AC[a-fA-F0-9]{32}"
                maxLength={34}
                autoComplete="off"
                spellCheck={false}
                placeholder="AC…"
              />
            </label>
            <label className="field">
              <span>Auth Token</span>
              <input
                name="authToken"
                type="password"
                required
                pattern="[a-fA-F0-9]{32}"
                maxLength={32}
                autoComplete="new-password"
                spellCheck={false}
              />
              <small>Encrypted when saved. Never shown again.</small>
            </label>
            <label className="field">
              <span>Business sender name</span>
              <input
                name="sender"
                required
                minLength={2}
                maxLength={100}
                defaultValue={connection.sender ?? ""}
                placeholder="Customer’s business name"
              />
            </label>
            <label className="field">
              <span>SMS support email</span>
              <input
                name="supportEmail"
                type="email"
                required
                autoComplete="off"
                defaultValue={connection.supportEmail ?? ""}
              />
            </label>
            <label className="sms-opt-in">
              <input name="approvedForMessaging" type="checkbox" />
              <span>
                I confirmed this sender is approved by Twilio for its intended
                messaging use. Leave unchecked to save setup with messaging off.
              </span>
            </label>
            <div className="connection-actions">
              <button className="button primary" disabled={busy} type="submit">
                {busy ? "Connecting…" : "Save Twilio connection"}
              </button>
              {editing && (
                <button
                  className="button secondary"
                  disabled={busy}
                  type="button"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        ) : (
          <>
            <p>
              {connection.status === "connected"
                ? "Team members can opt in and verify their phones in SMS preferences."
                : "Connection saved. Confirm sender approval before enabling messages."}
            </p>
            <div className="connection-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Update connection
              </button>
              {connection.status === "connected" && (
                <a className="button secondary" href={`/sms?company=${tenant}`}>
                  My SMS preferences
                </a>
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setConnection(
                      await api<NonNullable<typeof connection>>(
                        `${path}/disconnect`,
                        {},
                      ),
                    );
                    onNotice("Twilio disconnected. SMS is off.");
                  })
                }
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

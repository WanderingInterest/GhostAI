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
                        const next = await api<Connection>(`${path}/check`, {});
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
                  Disconnecting removes GhostAI’s stored key. Revoke the key in
                  OpenAI too if you want to disable it everywhere.
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

"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUp,
  AlertCircle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/firebase";

type ActionReceipt = {
  id: string;
  message: string;
  status: string;
  simulated: boolean;
};
type Turn = {
  id: string;
  message: string;
  reply: string;
  status: string;
  receipts: ActionReceipt[];
};
type Pending = { conversationId: string; turnId: string; message: string };
type Readiness = {
  connected: boolean;
  local: boolean;
  tools: { name: string; risk: string }[];
};

export function Assistant({
  tenant,
  uid,
  onChanged,
}: {
  tenant: string;
  uid: string;
  onChanged: () => Promise<void>;
}) {
  const [conversationId, setConversationId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const alive = useRef(true);
  const path = `/orgs/${tenant}/assistant`;
  const storage = `ghostai-assistant:${tenant}:${uid}`;
  useEffect(() => {
    alive.current = true;
    let saved: { conversationId?: string; pending?: Pending } = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(storage) || "{}");
    } catch {
      /* New conversation. */
    }
    const next = saved.conversationId || crypto.randomUUID();
    setConversationId(next);
    setPending(saved.pending ?? null);
    sessionStorage.setItem(
      storage,
      JSON.stringify({ conversationId: next, pending: saved.pending }),
    );
    api<Readiness>(path)
      .then((value) => {
        if (alive.current) setReady(value);
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    return () => {
      alive.current = false;
    };
  }, [storage, path]);
  const receive = useCallback(
    (next: { turns: Turn[]; reset?: boolean }) => {
      if (next.reset) {
        const fresh = crypto.randomUUID();
        sessionStorage.setItem(
          storage,
          JSON.stringify({ conversationId: fresh }),
        );
        setConversationId(fresh);
        setPending(null);
        setTurns([]);
        setError("Your access changed. A new conversation is ready.");
        return;
      }
      setTurns(next.turns);
      setPending((current) => {
        const turn = next.turns.find((t) => t.id === current?.turnId);
        if (turn && turn.status !== "running") {
          sessionStorage.setItem(storage, JSON.stringify({ conversationId }));
          return null;
        }
        return current;
      });
    },
    [storage, conversationId],
  );
  useEffect(() => {
    if (!conversationId) return;
    let current = true;
    api<{ turns: Turn[] }>(`${path}/${conversationId}`)
      .then((value) => {
        if (current) receive(value);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [path, conversationId, receive]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns, busy]);
  const running = turns.some((t) => t.status === "running");
  useEffect(() => {
    if (!running || busy) return;
    const timer = setInterval(() => {
      api<{ turns: Turn[] }>(`${path}/${conversationId}`)
        .then((value) => {
          if (alive.current) receive(value);
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [running, busy, path, conversationId, receive]);
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (sending.current || !ready?.connected) return;
    const input = pending ?? {
      conversationId,
      turnId: crypto.randomUUID(),
      message: draft.trim(),
    };
    if (!input.message) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setPending(input);
    sessionStorage.setItem(
      storage,
      JSON.stringify({ conversationId, pending: input }),
    );
    setDraft("");
    try {
      const next = await api<{ turns: Turn[] }>(path, input);
      if (alive.current) {
        receive(next);
        onChanged().catch(() => {});
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Connection interrupted. Check this message before sending another.",
        );
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function newConversation() {
    const next = crypto.randomUUID();
    sessionStorage.setItem(storage, JSON.stringify({ conversationId: next }));
    setConversationId(next);
    setTurns([]);
    setDraft("");
    setPending(null);
    setError("");
  }
  const optimistic = pending && !turns.some((t) => t.id === pending.turnId);
  const canManageCRM = Boolean(
    ready?.tools.some((tool) => tool.name === "customer_create"),
  );
  return (
    <section
      className="panel assistant-panel"
      aria-label="GhostAI conversation"
    >
      <div className="panel-heading">
        <div className="connection-heading">
          <span className="empty-icon">
            <MessageSquare size={21} />
          </span>
          <div>
            <h2>Your business assistant</h2>
            <p>
              {canManageCRM
                ? "Manage customers, properties, jobs, and service notes."
                : "Find a job. Capture a note. Keep work moving."}
            </p>
          </div>
        </div>
        <button
          className="button secondary"
          onClick={newConversation}
          disabled={busy || Boolean(pending) || running}
        >
          <Plus size={16} /> New chat
        </button>
      </div>
      {!ready && !error && (
        <p className="assistant-status" role="status">
          <LoaderCircle size={16} className="spin" /> Connecting…
        </p>
      )}
      {ready && !ready.connected && (
        <div className="assistant-status form-notice">
          {ready.local
            ? "The local assistant needs an OpenAI key configured on the backend."
            : "Ask your owner to connect OpenAI in Connections to start chatting."}
        </div>
      )}
      {ready?.connected && (
        <p className="assistant-status">
          {ready.local
            ? "Local demo · AI requests use your OpenAI account."
            : "Working with your demo CRM and GhostAI notes."}
        </p>
      )}
      <div
        className="assistant-transcript"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {!turns.length && !pending && (
          <div className="assistant-welcome">
            <span className="empty-icon">
              <MessageSquare size={25} />
            </span>
            <h3>What can I help with?</h3>
            <p>Ask naturally. I’ll use the tools your access allows.</p>
            <div className="assistant-starters">
              {[
                ...(canManageCRM
                  ? [
                      "Create a new customer",
                      "Find Johnson’s jobs",
                      "Schedule a new job",
                    ]
                  : [
                      "Find Johnson’s jobs",
                      "What jobs are scheduled?",
                      "Help me add a service note",
                    ]),
              ].map((value) => (
                <button
                  key={value}
                  disabled={!ready?.connected}
                  onClick={() => setDraft(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn) => (
          <div className="assistant-turn" key={turn.id}>
            <div className="assistant-message user">
              <span className="assistant-speaker">You</span>
              <p>{turn.message}</p>
            </div>
            <div className="assistant-message executive">
              <span className="assistant-speaker">GhostAI</span>
              {turn.status === "running" ? (
                <p className="assistant-thinking">
                  <LoaderCircle className="spin" size={16} /> Working…
                </p>
              ) : (
                <p>
                  {turn.reply ||
                    "This message was interrupted. Review any saved actions below before asking again."}
                </p>
              )}
              {turn.receipts.length > 0 && (
                <ul className="assistant-receipts">
                  {turn.receipts.map((receipt) => (
                    <li key={receipt.id}>
                      {receipt.status === "pending_confirmation" ? (
                        <Clock3 size={17} />
                      ) : receipt.status === "verified_persisted" ? (
                        <CheckCircle2 size={17} />
                      ) : (
                        <AlertCircle size={17} />
                      )}
                      <div>
                        <strong>{receipt.message}</strong>
                        <small>
                          {receipt.simulated ? "Demo CRM" : "GhostAI note"}
                          {receipt.status === "pending_confirmation"
                            ? " · Review in Approvals"
                            : ""}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {optimistic && (
          <>
            <div className="assistant-message user">
              <span className="assistant-speaker">You</span>
              <p>{pending.message}</p>
            </div>
            {busy && (
              <div className="assistant-message executive">
                <p className="assistant-thinking" role="status">
                  <LoaderCircle className="spin" size={16} /> Working…
                </p>
              </div>
            )}
          </>
        )}
        <div ref={end} />
      </div>
      <div className="assistant-compose-area">
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {pending && !busy && !running && (
          <button className="button secondary" onClick={() => send()}>
            <RefreshCw size={16} /> Check message
          </button>
        )}
        <form className="assistant-compose" onSubmit={send}>
          <label className="sr-only" htmlFor="assistant-message">
            Message GhostAI
          </label>
          <textarea
            id="assistant-message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              canManageCRM
                ? "Create a customer, schedule work, or update a record…"
                : "Ask about a job or tell me what needs recording…"
            }
            maxLength={2000}
            rows={2}
            disabled={!ready?.connected || busy || Boolean(pending) || running}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="button primary assistant-send"
            type="submit"
            aria-label="Send message"
            disabled={
              !ready?.connected ||
              !draft.trim() ||
              busy ||
              Boolean(pending) ||
              running
            }
          >
            <ArrowUp size={20} />
          </button>
        </form>
        <p className="assistant-footnote">
          Repair requests need owner approval. Saved actions appear with a
          receipt.
        </p>
      </div>
    </section>
  );
}

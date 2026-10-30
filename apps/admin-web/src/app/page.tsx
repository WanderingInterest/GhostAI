"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  reauthenticateWithCredential,
  EmailAuthProvider,
  type User,
} from "firebase/auth";
import {
  ArrowUpRight,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Ghost,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MapPin,
  RefreshCw,
  Plus,
  Search,
  Settings2,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { Connections } from "@/components/connections";
import { Assistant } from "@/components/assistant";
import { PolicyLinks } from "@/components/policy-shell";
import { api, ApiError, auth, authReady, emulator } from "@/lib/firebase";
import {
  Company,
  Customer,
  defaultPermissions,
  Job,
  Member,
  Permission,
  permissionLabels,
  Permissions,
  Property,
  Receipt,
  Workspace,
} from "@/lib/types";

type Tab =
  | "overview"
  | "assistant"
  | "customers"
  | "jobs"
  | "team"
  | "approvals"
  | "connections";
type Dialog =
  | { kind: "customer"; record?: Customer }
  | { kind: "property"; record?: Property; customerId?: string }
  | { kind: "job"; record?: Job }
  | { kind: "member"; record?: Member }
  | { kind: "detail"; jobId: string }
  | { kind: "invite-link"; url: string }
  | null;
const labels: Record<Tab, string> = {
  assistant: "Assistant",
  overview: "Overview",
  customers: "Customers",
  jobs: "Jobs",
  team: "Team",
  approvals: "Approvals",
  connections: "Connections",
};
const icons = {
  assistant: Sparkles,
  overview: LayoutDashboard,
  customers: Users,
  jobs: ClipboardList,
  team: ShieldCheck,
  approvals: Bell,
  connections: KeyRound,
};
const statusLabels = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
};
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
const errorText = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  if (
    code === "auth/invalid-credential" ||
    code === "auth/user-not-found" ||
    code === "auth/wrong-password"
  )
    return "Email or password is incorrect.";
  if (code === "auth/email-already-in-use")
    return "This email already has an account. Sign in instead.";
  if (code === "auth/weak-password")
    return "Use a password with at least 8 characters.";
  if (code === "auth/too-many-requests")
    return "Too many attempts. Please wait a moment and try again.";
  if (code === "auth/network-request-failed" || error instanceof TypeError)
    return emulator
      ? "Cannot connect to the local services. Start the Firebase emulators and try again."
      : "Cannot connect. Check your connection and try again.";
  if (code === "auth/operation-not-allowed")
    return "Email sign-in is not enabled for this Firebase project yet.";
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
};
function Empty({
  icon: Icon = ClipboardList,
  title,
  description,
  action,
}: {
  icon?: typeof Users;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={23} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = ref.current;
    (
      panel?.querySelector<HTMLElement>("input, select, textarea") ??
      panel?.querySelector<HTMLElement>("button")
    )?.focus();
    const key = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== panel) return;
      if (event.key === "Escape") close.current();
      if (event.key === "Tab" && panel) {
        const nodes = [
          ...panel.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
          ),
        ];
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? "dialog-description" : undefined}
      >
        <div className="modal-heading">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {description && <p id="dialog-description">{description}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button className="button primary" type="submit" disabled={busy}>
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Ghost size={24} strokeWidth={1.8} />
      </span>
      <span>
        ghost<span className="brand-ai">ai</span>
        <small>YOUR BUSINESS, IN GOOD HANDS.</small>
      </span>
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tenant, setTenant] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "reset">(
    "signin",
  );
  const [invitation, setInvitation] = useState<{
    tenant: string;
    token: string;
  } | null>(null);
  const [reauth, setReauth] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"notes" | "repairs">("notes");
  const conversation = useRef("");
  const pendingKey = useRef("");
  const owner = workspace?.member.role === "owner";
  useEffect(() => {
    conversation.current = crypto.randomUUID();
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "assistant") setTab("assistant");
    if (params.get("invite") && params.get("company"))
      setInvitation({
        tenant: params.get("company")!,
        token: params.get("invite")!,
      });
    let unsubscribe = () => {};
    let disposed = false;
    authReady
      .then(() => {
        if (disposed) return;
        unsubscribe = onAuthStateChanged(auth, (value) => {
          setUser(value);
          setReady(true);
          setWorkspace(null);
          setTenant("");
          setCompanies([]);
          setDialog(null);
          setAccountOpen(false);
          setError("");
        });
      })
      .catch((e) => {
        setError(errorText(e));
        setReady(true);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  const fail = useCallback((e: unknown) => {
    setError(errorText(e));
    if (e instanceof ApiError && e.status === 401) setReauth(true);
  }, []);
  const loadCompanies = useCallback(async () => {
    const data = await api<{ companies: Company[] }>("/me");
    setCompanies(data.companies);
    setTenant((current) =>
      data.companies.some((c) => c.id === current)
        ? current
        : (data.companies[0]?.id ?? ""),
    );
  }, []);
  useEffect(() => {
    if (user?.emailVerified) {
      setLoading(true);
      loadCompanies()
        .catch(fail)
        .finally(() => setLoading(false));
    }
  }, [user, loadCompanies, fail]);
  const refresh = useCallback(async () => {
    if (!tenant) return;
    const next = await api<Workspace>(`/orgs/${tenant}/state`);
    setWorkspace(next);
  }, [tenant]);
  useEffect(() => {
    if (
      workspace &&
      user?.emailVerified &&
      new URLSearchParams(window.location.search).get("returnTo") === "sms"
    ) {
      window.location.replace(`/sms?company=${tenant}`);
    }
  }, [workspace, user, tenant]);
  useEffect(() => {
    if (!tenant) return;
    let current = true;
    setLoading(true);
    setWorkspace(null);
    setSearch("");
    setDialog(null);
    api<Workspace>(`/orgs/${tenant}/state`)
      .then((data) => {
        if (current) setWorkspace(data);
      })
      .catch((e) => {
        if (current) fail(e);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [tenant, fail]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim(),
      password = String(form.get("password") ?? "");
    await action(async () => {
      if (authMode === "reset") {
        await sendPasswordResetEmail(auth, email);
        setNotice(
          emulator
            ? "Reset link created in the local Auth emulator; no email was sent."
            : "If this account exists, a reset link is on its way.",
        );
        setAuthMode("signin");
        return;
      }
      if (authMode === "signup") {
        const result = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        await sendEmailVerification(result.user);
      } else await signInWithEmailAndPassword(auth, email, password);
    });
  }
  async function verifyEmail() {
    await action(async () => {
      await auth.currentUser?.reload();
      await auth.currentUser?.getIdToken(true);
      const current = auth.currentUser;
      if (current?.emailVerified)
        setUser(
          Object.assign(Object.create(Object.getPrototypeOf(current)), current),
        );
      else
        setNotice(
          "Your email is not verified yet. Open the link in your email, then try again.",
        );
    });
  }
  async function submitOperation(
    operation: "business_note.create" | "service_request.create" | "job.update",
    args: Record<string, string>,
  ) {
    const receipt = await api<Receipt>(`/orgs/${tenant}/operations`, {
      key: pendingKey.current,
      conversationId: conversation.current,
      proposal: { operation, arguments: args },
    });
    pendingKey.current = crypto.randomUUID();
    // A failed refresh must not turn a confirmed save into a failed operation.
    try {
      await refresh();
    } catch {
      setError(
        "Your change was saved. Refresh the workspace to see the latest details.",
      );
    }
    setNotice(receipt.message);
  }
  const open = (next: Dialog) => {
    setError("");
    pendingKey.current = crypto.randomUUID();
    setDialog(next);
  };
  const close = () => {
    if (!busy) {
      setDialog(null);
      setError("");
    }
  };
  const jobTitle = (id: string) =>
    workspace?.jobs.find((j) => j.id === id)?.title ?? "Service job";
  const propertyFor = (job: Job) =>
    workspace?.properties.find((p) => p.id === job.propertyId);
  const customerFor = (job: Job) =>
    workspace?.customers.find((c) => c.id === propertyFor(job)?.customerId);
  const can = (permission: Permission, jobId?: string) =>
    owner ||
    Boolean(
      workspace?.member.permissions[permission] &&
      (!jobId ||
        workspace.member.permissions[permission] === "all" ||
        workspace.member.jobIds.includes(jobId)),
    );
  const controls = (
    <>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
  if (!ready)
    return (
      <div className="app-loading">
        <Ghost size={32} />
        <span>Opening your workspace…</span>
      </div>
    );
  if (!user)
    return (
      <div className="auth-shell">
        <div className="auth-story">
          <Brand />
          <div className="story-copy">
            <span className="eyebrow">A LITTLE LESS ON YOUR PLATE.</span>
            <h1>
              Good work deserves
              <br />
              less busywork.
            </h1>
            <p>
              Your customers, your crew, and the details that keep your business
              moving. All in one quiet place.
            </p>
            <div className="story-note">
              <div className="avatar mint">
                <CheckCheck size={20} />
              </div>
              <div>
                <strong>One less thing to remember.</strong>
                <span>
                  Your team handles the work. GhostAI keeps the details.
                </span>
              </div>
            </div>
          </div>
          <small>BUILT FOR THE PEOPLE WHO KEEP THINGS RUNNING.</small>
        </div>
        <main className="auth-main">
          {emulator && <span className="local-label">Local preview</span>}
          <div className="auth-card">
            <span className="eyebrow">WELCOME TO GHOSTAI</span>
            <h2>
              {authMode === "signup"
                ? "Make room for better work."
                : authMode === "reset"
                  ? "Let’s get you back in."
                  : "Welcome back."}
            </h2>
            <p>
              {invitation
                ? "Sign in with your invited email to join your team."
                : authMode === "signup"
                  ? "Create your account. Set up your business next."
                  : authMode === "reset"
                    ? "We’ll send a link to reset your password."
                    : "Sign in to pick up where you left off."}
            </p>
            {controls}
            <form onSubmit={authenticate}>
              <Field label="Email address">
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@yourbusiness.com"
                />
              </Field>
              {authMode !== "reset" && (
                <Field label="Password">
                  <input
                    name="password"
                    type="password"
                    minLength={authMode === "signup" ? 8 : undefined}
                    autoComplete={
                      authMode === "signup"
                        ? "new-password"
                        : "current-password"
                    }
                    required
                    placeholder={
                      authMode === "signup"
                        ? "At least 8 characters"
                        : "Your password"
                    }
                  />
                </Field>
              )}
              {authMode === "signin" && (
                <button
                  type="button"
                  className="text-button forgot"
                  onClick={() => {
                    setError("");
                    setAuthMode("reset");
                  }}
                >
                  Forgot password?
                </button>
              )}
              {authMode === "signup" && (
                <p className="helper signup-policy">
                  By creating an account, you agree to the{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer">
                    Terms & Conditions
                  </a>{" "}
                  and acknowledge the{" "}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer">
                    Privacy Policy
                  </a>
                  . SMS enrollment is separate and optional.
                </p>
              )}
              <Submit busy={busy}>
                {authMode === "signup"
                  ? "Create account"
                  : authMode === "reset"
                    ? "Send reset link"
                    : "Sign in"}
                <ArrowRight size={17} />
              </Submit>
            </form>
            <p className="auth-switch">
              {authMode === "signin"
                ? "New here? "
                : authMode === "signup"
                  ? "Already have an account? "
                  : ""}
              <button
                className="text-button"
                onClick={() => {
                  setError("");
                  setAuthMode(authMode === "signin" ? "signup" : "signin");
                }}
              >
                {authMode === "signin"
                  ? "Create an account"
                  : "Back to sign in"}
              </button>
            </p>
            {emulator && (
              <div className="demo-entry">
                <span>Just exploring?</span>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await signInWithEmailAndPassword(
                        auth,
                        "owner@demo.ghostai.test",
                        "DemoOnly-2026!",
                      );
                    })
                  }
                >
                  Open demo workspace <ArrowUpRight size={15} />
                </button>
              </div>
            )}
          </div>
          <small className="auth-footer">ghostai.dev · By Wandering Interest</small>
          <PolicyLinks />
        </main>
      </div>
    );
  if (!user.emailVerified)
    return (
      <div className="center-shell">
        <Brand />
        <section className="onboarding-card">
          <div className="empty-icon">
            <ShieldCheck />
          </div>
          <h1>{emulator ? "Local email verification" : "Check your inbox."}</h1>
          <p>
            {emulator ? (
              <>
                This preview does not send email or create users in your live
                Firebase project. Verification links appear in the local Auth
                emulator.
              </>
            ) : (
              <>
                Open the verification link sent to <strong>{user.email}</strong>
                , then continue.
              </>
            )}
          </p>
          {controls}
          <button
            className="button primary"
            disabled={busy}
            onClick={verifyEmail}
          >
            I’ve verified my email <ArrowRight size={16} />
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              action(async () => {
                await sendEmailVerification(user);
                setNotice(
                  emulator
                    ? "Verification link created in the local Auth emulator; no email was sent."
                    : "Verification email sent.",
                );
              })
            }
          >
            Resend email
          </button>
          <button className="text-button muted" onClick={() => signOut(auth)}>
            Use another account
          </button>
        </section>
      </div>
    );
  if (invitation)
    return (
      <div className="center-shell">
        <Brand />
        <section className="onboarding-card">
          <div className="empty-icon">
            <Users />
          </div>
          <h1>Your team is waiting.</h1>
          <p>
            Join your company as <strong>{user.email}</strong>. Your owner has
            already set up your access.
          </p>
          {controls}
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              action(async () => {
                const result = await api<{ id: string }>(
                  "/invitations/accept",
                  invitation,
                );
                setInvitation(null);
                window.history.replaceState({}, "", "/");
                await loadCompanies();
                setTenant(result.id);
                setNotice("You’re in. Welcome to the team.");
              })
            }
          >
            Join the team <ArrowRight size={16} />
          </button>
          <button className="text-button" onClick={() => signOut(auth)}>
            Sign in with another email
          </button>
        </section>
      </div>
    );
  if (!workspace)
    return (
      <div className="center-shell">
        <Brand />
        {loading ? (
          <div className="app-loading compact">
            <LoaderCircle className="spin" />
            <p>Getting things ready…</p>
          </div>
        ) : (
          <section className="onboarding-card">
            <span className="eyebrow">LET’S MAKE IT YOURS</span>
            <h1>What’s your business called?</h1>
            <p>
              Start with your company. Add customers and invite your team when
              you’re ready.
            </p>
            {controls}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const name = String(
                  new FormData(event.currentTarget).get("name"),
                );
                action(async () => {
                  const data = await api<{ id: string }>("/companies", {
                    name,
                  });
                  await loadCompanies();
                  setTenant(data.id);
                });
              }}
            >
              <Field label="Business name">
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder="Desert Pool Care"
                  autoComplete="organization"
                />
              </Field>
              <Submit busy={busy}>
                Create workspace <ArrowRight size={16} />
              </Submit>
            </form>
            <button className="text-button muted" onClick={() => signOut(auth)}>
              Sign out
            </button>
          </section>
        )}
      </div>
    );
  const jobs = workspace.jobs.filter((j) =>
    `${j.title} ${customerFor(j)?.name} ${propertyFor(j)?.address}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const customers = workspace.customers.filter((c) =>
    `${c.name} ${c.email ?? ""} ${c.phone ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const openRepairs = workspace.requests.filter((r) => r.status === "open");
  const completed = workspace.jobs.filter(
    (j) => j.status === "completed",
  ).length;
  const selectedJob =
    dialog?.kind === "detail"
      ? workspace.jobs.find((j) => j.id === dialog.jobId)
      : undefined;
  function jobRow(job: Job) {
    const property = propertyFor(job),
      customer = customerFor(job);
    return (
      <button
        className="job-row"
        key={job.id}
        onClick={() => {
          setDetailTab("notes");
          open({ kind: "detail", jobId: job.id });
        }}
      >
        <span
          className={`job-check ${job.status === "completed" ? "done" : ""}`}
        >
          {job.status === "completed" ? (
            <Check size={17} />
          ) : (
            <Wrench size={17} />
          )}
        </span>
        <span className="job-info">
          <strong>{job.title}</strong>
          <span>
            {customer?.name ?? "Customer"}
            <span className="dot">·</span>
            {property?.label ?? "Property"}
          </span>
        </span>
        <span className="job-date">
          <CalendarDays size={14} />
          {dateLabel(job.date)}
        </span>
        <span className={`pill ${job.status}`}>{statusLabels[job.status]}</span>
        <ChevronRight size={17} className="row-arrow" />
      </button>
    );
  }
  function addButton(label: string, fn: () => void) {
    return (
      <button className="button primary" onClick={fn}>
        <Plus size={17} />
        {label}
      </button>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="company-switch">
          <span className="company-icon">{workspace.company.name[0]}</span>
          {companies.length > 1 ? (
            <select
              aria-label="Company"
              value={tenant}
              onChange={(event) => setTenant(event.target.value)}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <div>
              <strong>{workspace.company.name}</strong>
              <small>Your workspace</small>
            </div>
          )}
        </div>
        <nav aria-label="Main navigation">
          {(
            [
              "overview",
              "assistant",
              "customers",
              "jobs",
              "team",
              "approvals",
              "connections",
            ] as Tab[]
          )
            .filter(
              (item) =>
                owner || !["team", "approvals", "connections"].includes(item),
            )
            .map((item) => {
              const Icon = icons[item];
              return (
                <button
                  key={item}
                  className={tab === item ? "active" : ""}
                  aria-current={tab === item ? "page" : undefined}
                  onClick={() => {
                    setTab(item);
                    setSearch("");
                    setError("");
                  }}
                >
                  <Icon size={19} />
                  <span>{labels[item]}</span>
                  {item === "approvals" && workspace.approvals.length > 0 && (
                    <b className="nav-count">{workspace.approvals.length}</b>
                  )}
                </button>
              );
            })}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-note">
            <span className="demo-dot" />
            <div>
              <strong>Demo CRM</strong>
              <span>Records stay in GhostAI.</span>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">
              {workspace.member.name[0].toUpperCase()}
            </span>
            <div>
              <strong>{workspace.member.name}</strong>
              <small>{owner ? "Business owner" : "Technician"}</small>
            </div>
            <button
              aria-label="Sign out"
              title="Sign out"
              className="icon-button"
              onClick={() => signOut(auth)}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{labels[tab]}</strong>
          </div>
          <div className="topbar-right">
            {emulator && <span className="preview-badge">Local preview</span>}
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              disabled={busy}
              onClick={() => action(refresh)}
            >
              <RefreshCw size={17} />
            </button>
            <span className="workspace-status">
              <span />
              {workspace.approvals.length
                ? `${workspace.approvals.length} to review`
                : "Workspace up to date"}
            </span>
            <button
              className="icon-button"
              aria-label="Account settings"
              title="Account settings"
              onClick={() => setAccountOpen(true)}
            >
              <Settings2 size={18} />
            </button>
            <button
              className="icon-button notification-button"
              aria-label="View approvals"
              onClick={() => setTab(owner ? "approvals" : "overview")}
            >
              <Bell size={19} />
              {workspace.approvals.length > 0 && <i />}
            </button>
          </div>
        </header>
        <main className="main-content" id="main">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {tab === "assistant"
                  ? "A HAND WITH THE EVERYDAY."
                  : tab === "overview"
                    ? "A LITTLE CLARITY FOR YOUR DAY."
                    : tab === "customers"
                      ? "GOOD RELATIONSHIPS START HERE."
                      : tab === "jobs"
                        ? "KEEP THE WORK MOVING."
                        : tab === "team"
                          ? "THE RIGHT ACCESS FOR THE RIGHT PEOPLE."
                          : tab === "connections"
                            ? "YOUR ACCOUNTS. CONNECTED SECURELY."
                            : "YOU HAVE THE FINAL SAY."}
              </span>
              <h1>
                {tab === "overview"
                  ? `Good to see you, ${workspace.member.name.split(" ")[0]}.`
                  : labels[tab]}
              </h1>
              <p>
                {tab === "assistant"
                  ? "Tell me what needs doing. I’ll help with the details."
                  : tab === "overview"
                    ? "Here’s what’s happening across your business."
                    : tab === "customers"
                      ? "Customer details, properties, and the work you do for them."
                      : tab === "jobs"
                        ? "Plan the visit. Capture the details. Close the loop."
                        : tab === "team"
                          ? "Invite your crew and choose what each person can do."
                          : tab === "connections"
                            ? "Manage the services your company uses with GhostAI."
                            : "Review repair requests before they’re added to your demo CRM."}
              </p>
            </div>
            {owner &&
              (["overview", "jobs"].includes(tab)
                ? addButton("New job", () => open({ kind: "job" }))
                : tab === "customers"
                  ? addButton("Add customer", () => open({ kind: "customer" }))
                  : tab === "team"
                    ? addButton("Invite teammate", () =>
                        open({ kind: "member" }),
                      )
                    : null)}
          </div>
          {!dialog && controls}
          {tab === "assistant" && (
            <Assistant
              key={`${tenant}:${user.uid}`}
              tenant={tenant}
              uid={user.uid}
              onChanged={refresh}
            />
          )}
          {tab === "overview" && (
            <>
              <div className="stats">
                <div>
                  <span>
                    <ClipboardList size={16} />
                    Active jobs
                  </span>
                  <strong>
                    {workspace.jobs.length - completed}
                    <small>ready to move forward</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <Users size={16} />
                    Customers
                  </span>
                  <strong>
                    {workspace.customers.length}
                    <small>relationships to look after</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <CheckCircle2 size={16} />
                    Completed
                  </span>
                  <strong>
                    {completed}
                    <small>jobs off your plate</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <Wrench size={16} />
                    Open repairs
                  </span>
                  <strong>
                    {openRepairs.length}
                    <small>requests to follow through</small>
                  </strong>
                </div>
              </div>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        On the schedule{" "}
                        <span className="count">
                          {
                            workspace.jobs.filter(
                              (j) => j.status !== "completed",
                            ).length
                          }
                        </span>
                      </h2>
                      <p>The next few things to take care of.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setTab("jobs")}
                    >
                      All jobs <ArrowRight size={14} />
                    </button>
                  </div>
                  {workspace.jobs.length ? (
                    workspace.jobs
                      .filter((j) => j.status !== "completed")
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .slice(0, 5)
                      .map(jobRow)
                  ) : (
                    <Empty
                      title="A clear schedule. A fresh start."
                      description={
                        owner
                          ? "Add your first customer and property, then schedule a job."
                          : "Your assigned jobs will appear here."
                      }
                      action={
                        owner && (
                          <button
                            className="button secondary"
                            onClick={() => setTab("customers")}
                          >
                            Add your first customer <ArrowRight size={15} />
                          </button>
                        )
                      }
                    />
                  )}
                  {workspace.jobs.length > 0 &&
                    completed === workspace.jobs.length && (
                      <Empty
                        icon={CheckCheck}
                        title="That’s everything."
                        description="All your jobs are completed."
                      />
                    )}
                </section>
                <section className="panel attention-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">A HAND WITH THE DETAILS</span>
                      <h2>
                        {workspace.approvals.length
                          ? "Your approval is needed."
                          : "A little peace of mind."}
                      </h2>
                    </div>
                    <Sparkles size={23} />
                  </div>
                  {workspace.approvals.length ? (
                    <>
                      <div className="attention-request">
                        <strong>
                          {jobTitle(workspace.approvals[0].jobId ?? "")}
                        </strong>
                        <p>{workspace.approvals[0].args?.text}</p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => setTab("approvals")}
                      >
                        Review requests <ArrowRight size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="calm-art" aria-hidden="true">
                        <div className="orbit orbit-one" />
                        <div className="orbit orbit-two" />
                        <div className="orbit-center">
                          <Ghost size={36} strokeWidth={1.4} />
                        </div>
                        <span className="art-check">
                          <Check size={15} />
                        </span>
                      </div>
                      <p>
                        Keep service notes close to the job. Give your team
                        clear access. Let fewer details slip through.
                      </p>
                      <span className="quiet-status">
                        <CheckCircle2 size={15} />
                        No approvals waiting
                      </span>
                    </>
                  )}
                </section>
              </div>
              <section className="panel activity-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Recent activity</h2>
                    <p>What’s been taken care of.</p>
                  </div>
                  <Clock3 size={18} className="muted" />
                </div>
                {workspace.receipts.slice(0, 4).map((r) => (
                  <div className="activity-row" key={r.id}>
                    <span
                      className={`activity-icon ${r.status === "rejected" ? "declined" : ""}`}
                    >
                      {r.status === "pending_confirmation" ? (
                        <Clock3 size={17} />
                      ) : r.status === "rejected" ? (
                        <X size={17} />
                      ) : (
                        <Check size={17} />
                      )}
                    </span>
                    <div>
                      <strong>{r.message}</strong>
                      <span>
                        {r.actorName} ·{" "}
                        {new Date(r.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <span className="muted activity-time">
                      {new Date(r.createdAt).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
                {workspace.receipts.length === 0 && (
                  <p className="inline-empty">
                    Saved notes and completed updates will appear here.
                  </p>
                )}
              </section>
            </>
          )}
          {tab === "customers" && (
            <section className="panel">
              <div className="list-toolbar">
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search customers"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search customers…"
                  />
                </label>
                <span className="muted">
                  {customers.length} customer{customers.length === 1 ? "" : "s"}
                </span>
              </div>
              {customers.length ? (
                <div className="customer-grid">
                  {customers.map((customer) => {
                    const properties = workspace.properties.filter(
                      (p) => p.customerId === customer.id,
                    );
                    return (
                      <article className="customer-card" key={customer.id}>
                        <div className="customer-top">
                          <span className="avatar customer-avatar">
                            {customer.name
                              .split(" ")
                              .slice(0, 2)
                              .map((n) => n[0])
                              .join("")}
                          </span>
                          <div>
                            <h3>{customer.name}</h3>
                            <span className="muted">
                              {properties.length} propert
                              {properties.length === 1 ? "y" : "ies"}
                            </span>
                          </div>
                          {owner && (
                            <button
                              className="icon-button"
                              aria-label={`Edit ${customer.name}`}
                              onClick={() =>
                                open({ kind: "customer", record: customer })
                              }
                            >
                              <Settings2 size={17} />
                            </button>
                          )}
                        </div>
                        {customer.email && (
                          <a
                            className="customer-contact"
                            href={`mailto:${customer.email}`}
                          >
                            {customer.email}
                          </a>
                        )}
                        {customer.phone && (
                          <a
                            className="customer-contact"
                            href={`tel:${customer.phone}`}
                          >
                            {customer.phone}
                          </a>
                        )}
                        <div className="property-list">
                          {properties.map((property) => (
                            <button
                              key={property.id}
                              disabled={!owner}
                              onClick={() =>
                                open({ kind: "property", record: property })
                              }
                            >
                              <MapPin size={15} />
                              <span>
                                <strong>{property.label}</strong>
                                <small>{property.address}</small>
                              </span>
                              {owner && <ChevronRight size={14} />}
                            </button>
                          ))}
                        </div>
                        {owner && (
                          <button
                            className="text-button add-property"
                            onClick={() =>
                              open({
                                kind: "property",
                                customerId: customer.id,
                              })
                            }
                          >
                            <Plus size={14} />
                            Add property
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <Empty
                  icon={Users}
                  title={
                    search
                      ? "No matching customers."
                      : "Your first customer starts here."
                  }
                  description={
                    search
                      ? "Try another name or email address."
                      : "Keep their details and properties together, ready for your next visit."
                  }
                  action={
                    owner &&
                    !search &&
                    addButton("Add customer", () => open({ kind: "customer" }))
                  }
                />
              )}
            </section>
          )}
          {tab === "jobs" && (
            <section className="panel">
              <div className="list-toolbar">
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search jobs"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search jobs, customers, properties…"
                  />
                </label>
                <span className="muted">
                  {jobs.length} job{jobs.length === 1 ? "" : "s"}
                </span>
              </div>
              {jobs.length ? (
                jobs.sort((a, b) => a.date.localeCompare(b.date)).map(jobRow)
              ) : (
                <Empty
                  title={
                    search ? "No jobs found." : "Make room for the next job."
                  }
                  description={
                    search
                      ? "Try a different customer or property."
                      : owner
                        ? "Add a property to a customer, then schedule the work."
                        : "Your owner will assign jobs here."
                  }
                  action={
                    owner &&
                    !search &&
                    addButton("New job", () => open({ kind: "job" }))
                  }
                />
              )}
            </section>
          )}
          {tab === "team" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    Your people{" "}
                    <span className="count">
                      {workspace.team.filter((m) => m.active).length}
                    </span>
                  </h2>
                  <p>Access stays within your company.</p>
                </div>
              </div>
              {workspace.team.map((member) => (
                <div className="team-row" key={member.uid}>
                  <span className="avatar">{member.name[0].toUpperCase()}</span>
                  <div className="team-person">
                    <strong>
                      {member.name}{" "}
                      {member.uid === user.uid && <small>(you)</small>}
                    </strong>
                    <span>{member.email}</span>
                  </div>
                  <span className={`pill ${member.active ? "" : "inactive"}`}>
                    {member.role === "owner"
                      ? "Owner"
                      : member.active
                        ? "Technician"
                        : "Access paused"}
                  </span>
                  {member.role === "technician" && (
                    <button
                      className="button secondary small"
                      onClick={() => open({ kind: "member", record: member })}
                    >
                      Manage access
                    </button>
                  )}
                </div>
              ))}
              {workspace.invitations
                .filter((i) => i.status === "pending")
                .map((invite) => (
                  <div className="team-row" key={invite.id}>
                    <span className="avatar invitation-avatar">
                      <Clock3 size={19} />
                    </span>
                    <div className="team-person">
                      <strong>{invite.name}</strong>
                      <span>{invite.email}</span>
                    </div>
                    <span className="pill scheduled">
                      {invite.expiresAt > Date.now() ? "Invited" : "Expired"}
                    </span>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          await api(`/orgs/${tenant}/invites/${invite.id}`, {});
                          await refresh();
                          setNotice("Invitation canceled.");
                        })
                      }
                    >
                      Cancel invitation
                    </button>
                  </div>
                ))}
            </section>
          )}
          {tab === "connections" && owner && (
            <Connections
              tenant={tenant}
              busy={busy}
              run={action}
              onError={fail}
              onNotice={setNotice}
            />
          )}
          {tab === "approvals" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    Waiting for you{" "}
                    <span className="count">{workspace.approvals.length}</span>
                  </h2>
                  <p>Approvals apply only to the details shown below.</p>
                </div>
              </div>
              {workspace.approvals.length ? (
                workspace.approvals.map((request) => (
                  <article className="approval-row" key={request.id}>
                    <div className="approval-icon">
                      <Wrench size={20} />
                    </div>
                    <div className="approval-content">
                      <div className="approval-title">
                        <h3>Repair request</h3>
                        <span className="pill scheduled">
                          {(request.expiresAt ?? 0) > Date.now()
                            ? "Needs approval"
                            : "Expired"}
                        </span>
                      </div>
                      <p>{request.args?.text}</p>
                      <span className="muted">
                        {request.actorName} · {jobTitle(request.jobId ?? "")}
                      </span>
                      <small>Added to the demo CRM when approved.</small>
                    </div>
                    <div className="approval-actions">
                      <button
                        className="button primary small"
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            const result = await api<Receipt>(
                              `/orgs/${tenant}/approvals/${request.id}`,
                              { approve: true },
                            );
                            await refresh();
                            setNotice(result.message);
                          })
                        }
                      >
                        <Check size={15} />
                        Approve
                      </button>
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            await api(
                              `/orgs/${tenant}/approvals/${request.id}`,
                              { approve: false },
                            );
                            await refresh();
                            setNotice("Request declined.");
                          })
                        }
                      >
                        Decline
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <Empty
                  icon={CheckCheck}
                  title="Nothing waiting on you."
                  description="Repair requests that need your approval will appear here."
                />
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>
              <Ghost size={14} />ghostai.dev · A little less busywork.
            </span>
            <PolicyLinks />
          </footer>
        </main>
      </div>
      {dialog && dialog.kind !== "detail" && (
        <Modal
          title={
            dialog.kind === "customer"
              ? dialog.record
                ? "Edit customer"
                : "Add a customer"
              : dialog.kind === "property"
                ? dialog.record
                  ? "Edit property"
                  : "Add a property"
                : dialog.kind === "job"
                  ? dialog.record
                    ? "Edit job"
                    : "Schedule a job"
                  : dialog.kind === "member"
                    ? dialog.record
                      ? "Manage technician access"
                      : "Invite a teammate"
                    : "Your invitation is ready"
          }
          description={
            dialog.kind === "member"
              ? "Choose what they can do. You can change access anytime."
              : undefined
          }
          onClose={close}
        >
          {controls}
          {dialog.kind === "invite-link" ? (
            <div className="invite-success">
              <div className="empty-icon">
                <CheckCheck size={26} />
              </div>
              <p>
                Share this link with your teammate. They’ll sign in with their
                invited email address.
              </p>
              <label className="field">
                <span>Invitation link</span>
                <input
                  readOnly
                  value={dialog.url}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <p className="helper">
                Valid for 7 days. No email has been sent automatically.
              </p>
              <button
                className="button primary"
                onClick={() =>
                  action(async () => {
                    await navigator.clipboard.writeText(dialog.url);
                    setNotice("Invitation link copied.");
                  })
                }
              >
                <Copy size={16} />
                Copy invitation
              </button>
              <button className="button secondary" onClick={close}>
                Done
              </button>
            </div>
          ) : (
            <form
              key={`${dialog.kind}-${dialog.record?.id ?? (dialog.kind === "member" ? dialog.record?.uid : "new")}`}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const kind = dialog.kind;
                action(async () => {
                  if (kind === "member") {
                    const permissions: Permissions = {};
                    (Object.keys(permissionLabels) as Permission[]).forEach(
                      (key) => {
                        const value = form.get(key);
                        if (value)
                          permissions[key] = value as
                            "own" | "assigned" | "all";
                      },
                    );
                    const jobIds = form.getAll("jobIds").map(String);
                    const name = String(form.get("name"));
                    if (dialog.record) {
                      await api(
                        `/orgs/${tenant}/members/${dialog.record.uid}`,
                        {
                          name,
                          permissions,
                          jobIds,
                          active: form.get("active") === "on",
                        },
                      );
                      setDialog(null);
                      setNotice("Team access updated.");
                    } else {
                      const invite = await api<{
                        token: string;
                        tenant: string;
                      }>(`/orgs/${tenant}/invites`, {
                        name,
                        email: String(form.get("email")),
                        permissions,
                        jobIds,
                      });
                      setDialog({
                        kind: "invite-link",
                        url: `${window.location.origin}/?company=${invite.tenant}&invite=${invite.token}`,
                      });
                    }
                  } else {
                    const data =
                      kind === "customer"
                        ? {
                            name: String(form.get("name")),
                            email: String(form.get("email")),
                            phone: String(form.get("phone")),
                          }
                        : kind === "property"
                          ? {
                              customerId: String(form.get("customerId")),
                              label: String(form.get("label")),
                              address: String(form.get("address")),
                            }
                          : {
                              propertyId: String(form.get("propertyId")),
                              title: String(form.get("title")),
                              date: String(form.get("date")),
                            };
                    const resource =
                      kind === "property"
                        ? "properties"
                        : kind === "customer"
                          ? "customers"
                          : "jobs";
                    await api(
                      `/orgs/${tenant}/${resource}${dialog.record ? `/${dialog.record.id}` : ""}`,
                      dialog.record ? data : { key: pendingKey.current, data },
                    );
                    setDialog(null);
                    setNotice(
                      dialog.record
                        ? "Changes saved."
                        : kind === "customer"
                          ? "Customer added."
                          : kind === "property"
                            ? "Property added."
                            : "Job scheduled.",
                    );
                  }
                  await refresh();
                });
              }}
            >
              {dialog.kind === "customer" && (
                <>
                  <Field label="Customer name">
                    <input
                      name="name"
                      required
                      maxLength={120}
                      defaultValue={dialog.record?.name}
                      placeholder="Jamie Johnson"
                      autoComplete="name"
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Email (optional)">
                      <input
                        name="email"
                        type="email"
                        defaultValue={dialog.record?.email}
                        autoComplete="email"
                        placeholder="jamie@example.com"
                      />
                    </Field>
                    <Field label="Phone (optional)">
                      <input
                        name="phone"
                        type="tel"
                        maxLength={40}
                        defaultValue={dialog.record?.phone}
                        autoComplete="tel"
                        placeholder="(602) 555-0142"
                      />
                    </Field>
                  </div>
                </>
              )}
              {dialog.kind === "property" && (
                <>
                  <Field label="Customer">
                    <select
                      name="customerId"
                      required
                      defaultValue={
                        dialog.record?.customerId ?? dialog.customerId ?? ""
                      }
                    >
                      <option value="" disabled>
                        Choose a customer
                      </option>
                      {workspace.customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Property name">
                    <input
                      name="label"
                      required
                      maxLength={120}
                      defaultValue={dialog.record?.label}
                      placeholder="Home · North Scottsdale"
                    />
                  </Field>
                  <Field label="Street address">
                    <input
                      name="address"
                      required
                      maxLength={250}
                      autoComplete="street-address"
                      defaultValue={dialog.record?.address}
                      placeholder="1234 E Desert Road, Scottsdale, AZ"
                    />
                  </Field>
                </>
              )}
              {dialog.kind === "job" && (
                <>
                  {workspace.properties.length === 0 ? (
                    <div className="form-notice">
                      Add a customer and property before scheduling a job.{" "}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setDialog(null);
                          setTab("customers");
                        }}
                      >
                        Go to customers <ArrowRight size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Field label="What needs doing?">
                        <input
                          name="title"
                          required
                          maxLength={160}
                          defaultValue={dialog.record?.title}
                          placeholder="Weekly pool service"
                        />
                      </Field>
                      <Field label="Property">
                        <select
                          name="propertyId"
                          required
                          defaultValue={dialog.record?.propertyId ?? ""}
                        >
                          <option value="" disabled>
                            Choose a property
                          </option>
                          {workspace.properties.map((p) => (
                            <option key={p.id} value={p.id}>
                              {
                                workspace.customers.find(
                                  (c) => c.id === p.customerId,
                                )?.name
                              }{" "}
                              · {p.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Scheduled date">
                        <input
                          name="date"
                          type="date"
                          required
                          defaultValue={
                            dialog.record?.date ??
                            new Date().toLocaleDateString("en-CA")
                          }
                        />
                      </Field>
                    </>
                  )}
                </>
              )}
              {dialog.kind === "member" && (
                <>
                  <div className="form-grid">
                    <Field label="Name">
                      <input
                        name="name"
                        required
                        maxLength={120}
                        defaultValue={dialog.record?.name}
                        placeholder="Alex Rivera"
                      />
                    </Field>
                    <Field label="Email">
                      <input
                        name="email"
                        type="email"
                        required
                        readOnly={!!dialog.record}
                        defaultValue={dialog.record?.email}
                        placeholder="alex@example.com"
                      />
                    </Field>
                  </div>
                  <fieldset className="permission-set">
                    <legend>Permissions</legend>
                    {(
                      Object.entries(permissionLabels) as [Permission, string][]
                    ).map(([key, label]) => (
                      <label key={key} className="permission-row">
                        <span>
                          {label}
                          {key === "service_request.create" && (
                            <small>Owner approval always required</small>
                          )}
                        </span>
                        <select
                          name={key}
                          defaultValue={
                            (dialog.record?.permissions ?? defaultPermissions)[
                              key
                            ] ?? ""
                          }
                        >
                          <option value="">No access</option>
                          {key === "business_note.list" && (
                            <option value="own">Own notes</option>
                          )}
                          <option value="assigned">Assigned jobs</option>
                          <option value="all">All company jobs</option>
                        </select>
                      </label>
                    ))}
                  </fieldset>
                  <fieldset className="assignment-set">
                    <legend>Assigned jobs</legend>
                    {workspace.jobs.length ? (
                      workspace.jobs.map((job) => (
                        <label className="checkbox-row" key={job.id}>
                          <input
                            name="jobIds"
                            value={job.id}
                            type="checkbox"
                            defaultChecked={dialog.record?.jobIds.includes(
                              job.id,
                            )}
                          />
                          <span>
                            {job.title}
                            <small>{customerFor(job)?.name}</small>
                          </span>
                        </label>
                      ))
                    ) : (
                      <p className="helper">
                        Schedule a job first, or assign work later.
                      </p>
                    )}
                  </fieldset>
                  {dialog.record && (
                    <label className="checkbox-row active-toggle">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={dialog.record.active}
                      />
                      <span>
                        Active team member
                        <small>Uncheck to pause all company access.</small>
                      </span>
                    </label>
                  )}
                </>
              )}
              <div className="modal-footer">
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={close}
                >
                  Cancel
                </button>
                {!(
                  dialog.kind === "job" && workspace.properties.length === 0
                ) && (
                  <Submit busy={busy}>
                    {dialog.record
                      ? "Save changes"
                      : dialog.kind === "member"
                        ? "Create invitation"
                        : dialog.kind === "job"
                          ? "Schedule job"
                          : dialog.kind === "property"
                            ? "Add property"
                            : "Add customer"}
                  </Submit>
                )}
              </div>
            </form>
          )}
        </Modal>
      )}
      {dialog?.kind === "detail" && selectedJob && (
        <Modal
          title={selectedJob.title}
          description={`${customerFor(selectedJob)?.name ?? ""} · ${propertyFor(selectedJob)?.label ?? ""}`}
          onClose={close}
          wide
        >
          {controls}
          <div className="job-detail-meta">
            <div>
              <MapPin size={17} />
              <span>{propertyFor(selectedJob)?.address}</span>
            </div>
            <div>
              <CalendarDays size={17} />
              <span>{dateLabel(selectedJob.date)}</span>
              {owner && (
                <button
                  className="text-button"
                  onClick={() => open({ kind: "job", record: selectedJob })}
                >
                  Edit job
                </button>
              )}
            </div>
          </div>
          <div className="job-status-bar">
            <span>Status</span>
            {can("job.update", selectedJob.id) ? (
              <select
                aria-label="Job status"
                value={selectedJob.status}
                disabled={busy}
                onChange={(event) => {
                  const status = event.target.value;
                  action(() =>
                    submitOperation("job.update", {
                      jobId: selectedJob.id,
                      status,
                    }),
                  );
                }}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <span className={`pill ${selectedJob.status}`}>
                {statusLabels[selectedJob.status]}
              </span>
            )}
            <small>Demo CRM</small>
          </div>
          <div className="detail-tabs">
            <button
              className={detailTab === "notes" ? "selected" : ""}
              onClick={() => setDetailTab("notes")}
            >
              Service notes{" "}
              <span>
                {
                  workspace.notes.filter((n) => n.jobId === selectedJob.id)
                    .length
                }
              </span>
            </button>
            <button
              className={detailTab === "repairs" ? "selected" : ""}
              onClick={() => setDetailTab("repairs")}
            >
              Repairs{" "}
              <span>
                {
                  workspace.requests.filter(
                    (r) => r.jobId === selectedJob.id && r.status === "open",
                  ).length
                }
              </span>
            </button>
          </div>
          {detailTab === "notes" ? (
            <>
              <div className="notes-list">
                {workspace.notes
                  .filter((n) => n.jobId === selectedJob.id)
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((note) => (
                    <article className="service-note" key={note.id}>
                      <p>{note.text}</p>
                      <small>
                        {note.authorName} ·{" "}
                        {new Date(note.createdAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </small>
                    </article>
                  ))}
                {!workspace.notes.some((n) => n.jobId === selectedJob.id) && (
                  <p className="inline-empty">
                    {can("business_note.list", selectedJob.id)
                      ? "No notes yet. Leave the next person a useful detail."
                      : "Your access does not include service notes."}
                  </p>
                )}
              </div>
              {can("business_note.create", selectedJob.id) && (
                <form
                  className="compose-note"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const text = String(new FormData(form).get("text"));
                    action(async () => {
                      await submitOperation("business_note.create", {
                        jobId: selectedJob.id,
                        text,
                      });
                      form.reset();
                    });
                  }}
                >
                  <Field label="Add a service note">
                    <textarea
                      name="text"
                      required
                      maxLength={2000}
                      rows={3}
                      placeholder="What was done? What should the next visit know?"
                    />
                  </Field>
                  <Submit busy={busy}>
                    Save note <Check size={16} />
                  </Submit>
                </form>
              )}
            </>
          ) : (
            <>
              <div className="notes-list">
                {workspace.requests
                  .filter((r) => r.jobId === selectedJob.id)
                  .map((request) => (
                    <article
                      className="service-note repair-note"
                      key={request.id}
                    >
                      <div>
                        <p>{request.text}</p>
                        <span
                          className={`pill ${request.status === "resolved" ? "completed" : "scheduled"}`}
                        >
                          {request.status === "resolved"
                            ? "Resolved"
                            : "Open repair"}
                        </span>
                      </div>
                      {owner && request.status === "open" && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            action(async () => {
                              await api(
                                `/orgs/${tenant}/repairs/${request.id}`,
                                {},
                              );
                              await refresh();
                              setNotice("Repair marked resolved.");
                            })
                          }
                        >
                          Mark resolved <Check size={14} />
                        </button>
                      )}
                    </article>
                  ))}
                {!workspace.requests.some(
                  (r) => r.jobId === selectedJob.id,
                ) && <p className="inline-empty">No repairs on this job.</p>}
              </div>
              {can("service_request.create", selectedJob.id) && (
                <form
                  className="compose-note"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const text = String(new FormData(form).get("text"));
                    action(async () => {
                      await submitOperation("service_request.create", {
                        jobId: selectedJob.id,
                        text,
                      });
                      form.reset();
                    });
                  }}
                >
                  <Field
                    label="What needs repairing?"
                    hint="The owner will review this before it is saved to the demo CRM."
                  >
                    <textarea
                      name="text"
                      required
                      maxLength={2000}
                      rows={3}
                      placeholder="Describe the issue and any useful details."
                    />
                  </Field>
                  <Submit busy={busy}>
                    Request owner approval <ArrowRight size={16} />
                  </Submit>
                </form>
              )}
            </>
          )}
        </Modal>
      )}
      {accountOpen && (
        <Modal
          title="Your account"
          description={user.email ?? undefined}
          onClose={() => !busy && setAccountOpen(false)}
        >
          {controls}
          <div className="account-actions">
            <div>
              <h3>SMS preferences</h3>
              <p className="helper">
                Choose whether to receive work-related text messages.
              </p>
              <a className="button secondary" href={`/sms?company=${tenant}`}>
                Manage SMS preferences
              </a>
            </div>
            <div>
              <h3>Reset your password</h3>
              <p className="helper">
                Receive a secure reset link at your account email.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await sendPasswordResetEmail(auth, user.email!);
                    setNotice(
                      emulator
                        ? "Reset link created in the local Auth emulator; no email was sent."
                        : "Password reset email sent.",
                    );
                  })
                }
              >
                Send password reset link
              </button>
            </div>
            <div>
              <h3>Sign out all devices</h3>
              <p className="helper">
                End your sessions on every device, including this one.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api("/account/revoke-sessions", {});
                    setAccountOpen(false);
                    await signOut(auth);
                    setNotice("All devices have been signed out.");
                  })
                }
              >
                Sign out all devices
              </button>
            </div>
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setAccountOpen(false);
                await signOut(auth);
              }}
            >
              Sign out of this device
            </button>
          </div>
        </Modal>
      )}
      {reauth && (
        <Modal
          title="Confirm it’s you"
          description="Please enter your password again to make this change."
          onClose={() => setReauth(false)}
        >
          {controls}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const password = String(
                new FormData(event.currentTarget).get("password"),
              );
              action(async () => {
                await reauthenticateWithCredential(
                  user,
                  EmailAuthProvider.credential(user.email!, password),
                );
                await user.getIdToken(true);
                setReauth(false);
                setNotice("Identity confirmed. You can try your change again.");
              });
            }}
          >
            <Field label="Password">
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <div className="modal-footer">
              <Submit busy={busy}>Confirm identity</Submit>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

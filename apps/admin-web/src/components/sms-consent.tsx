"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { api, auth, authReady, emulator } from "@/lib/firebase";
import policy, { smsNumber } from "@/lib/messaging-policy";
import type { Company } from "@/lib/types";

type Consent = {
  status: string;
  phone: string;
  revision: number;
  consentedAt: number | null;
  withdrawnAt: number | null;
  version: string | null;
};
export function SmsConsent() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tenant, setTenant] = useState("");
  const [consent, setConsent] = useState<Consent | null>(null);
  const [phone, setPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<{ digest: string; body: object } | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    let dispose = () => {},
      current = true;
    authReady
      .then(() => {
        if (!current) return;
        dispose = onAuthStateChanged(auth, (value) => {
          setUser(value);
          setLoaded(true);
          setConsent(null);
          setCompanies([]);
          setTenant("");
          setPhone("");
          setAgreed(false);
          pending.current = null;
        });
      })
      .catch(() => {
        if (current) {
          setLoaded(true);
          setError("Sign-in could not be loaded. Refresh and try again.");
        }
      });
    return () => {
      current = false;
      dispose();
    };
  }, []);
  useEffect(() => {
    if (!user?.emailVerified) return;
    let current = true;
    api<{ companies: Company[] }>("/me")
      .then((result) => {
        if (!current) return;
        setCompanies(result.companies);
        const selected = new URLSearchParams(window.location.search).get(
          "company",
        );
        setTenant(
          result.companies.some((c) => c.id === selected)
            ? selected!
            : (result.companies[0]?.id ?? ""),
        );
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [user]);
  useEffect(() => {
    if (!tenant) return;
    let current = true;
    setConsent(null);
    setAgreed(false);
    setNotice("");
    setError("");
    pending.current = null;
    api<Consent>(`/orgs/${tenant}/messaging-consent`)
      .then((value) => {
        if (current) {
          setConsent(value);
          setPhone(value.phone);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [tenant]);
  const enrolled = consent?.status === "consented_pending_verification";
  async function save(action: "opt_in" | "withdraw", event?: FormEvent) {
    event?.preventDefault();
    if (!consent || !tenant || saving.current) return;
    if (
      action === "opt_in" &&
      (!agreed || !/^\+[1-9]\d{7,14}$/.test(phone.trim()))
    ) {
      setError(
        "Enter your number with country code, then select the optional SMS consent box.",
      );
      return;
    }
    const fields =
      action === "opt_in"
        ? {
            action,
            phone: phone.trim(),
            agreed: true,
            version: policy.version,
            expectedRevision: consent.revision,
          }
        : { action, expectedRevision: consent.revision };
    const digest = JSON.stringify(fields);
    const body =
      pending.current?.digest === digest
        ? pending.current.body
        : { ...fields, key: crypto.randomUUID() };
    pending.current = { digest, body };
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await api<Consent>(
        `/orgs/${tenant}/messaging-consent`,
        body,
      );
      setConsent(value);
      setPhone(value.phone);
      setAgreed(false);
      pending.current = null;
      setNotice(
        value.status === "withdrawn"
          ? "SMS consent withdrawn. Your web account is unchanged."
          : "Your consent is recorded. Texting will remain off until phone verification and SMS setup are complete.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save your choice. Try again.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="sms-enrollment">
      <div className="sms-program-heading">
        <h2>{policy.program}</h2>
        <p>
          {policy.sender}
          {smsNumber ? ` · ${smsNumber}` : ""}
        </p>
      </div>
      <p>
        Choose whether to receive work-related SMS on your own mobile phone. You
        can use GhostAI’s web app without enrolling.
      </p>
      {emulator && user && (
        <p className="form-notice">
          Local preview: preferences are saved only in the emulator.
        </p>
      )}
      {!loaded && (
        <p className="helper" role="status">
          <LoaderCircle className="spin" size={15} /> Checking sign-in…
        </p>
      )}
      {loaded && !user && (
        <p className="form-notice">
          <Link href="/?returnTo=sms">Sign in or create an account</Link> to
          save your own preference. The form below shows the consent you will be
          asked to provide.
        </p>
      )}
      {user && !user.emailVerified && (
        <p className="form-notice">
          <Link href="/?returnTo=sms">Verify your email in the app</Link> before
          saving SMS preferences.
        </p>
      )}
      {user?.emailVerified && companies.length === 0 && (
        <p className="form-notice">
          Join or create your company in the app first. SMS enrollment is
          optional afterward.
        </p>
      )}
      {companies.length > 1 && (
        <label className="field">
          <span>Your company</span>
          <select
            value={tenant}
            onChange={(event) => setTenant(event.target.value)}
            disabled={busy}
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {companies.length === 1 && (
        <p className="helper">Your company: {companies[0].name}</p>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => window.location.reload()}
          >
            Refresh preferences
          </button>
        </div>
      )}
      {notice && (
        <div className="alert" role="status">
          <CheckCircle2 size={17} /> {notice}
        </div>
      )}
      {enrolled && (
        <div className="sms-saved">
          <h3>Consent recorded</h3>
          <p>
            {consent.phone} ·{" "}
            {consent.consentedAt
              ? new Date(consent.consentedAt).toLocaleDateString()
              : ""}
          </p>
          <p>Phone verification pending. SMS is not active yet.</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => save("withdraw")}
          >
            Withdraw SMS consent
          </button>
        </div>
      )}
      {consent?.status === "withdrawn" && (
        <p className="form-notice">
          You have opted out. A new voluntary opt-in is required to enroll
          again.
        </p>
      )}
      <form
        onSubmit={(event) => save("opt_in", event)}
        className="sms-consent-form"
      >
        <label className="field" htmlFor="sms-phone">
          <span>Your mobile number</span>
          <input
            id="sms-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+16025550123"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value.replace(/[\s().-]/g, ""));
              setAgreed(false);
            }}
            pattern="\+[1-9][0-9]{7,14}"
            maxLength={16}
            disabled={busy}
            aria-describedby="sms-phone-help"
          />
        </label>
        <p className="helper" id="sms-phone-help">
          Include your country code, with no spaces (for example, +16025550123).
          Enter only a number you control. This does not verify ownership.
        </p>
        <label className="sms-opt-in">
          <input
            type="checkbox"
            name="smsConsent"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
            disabled={busy}
          />
          <span>{policy.disclosure}</span>
        </label>
        <p className="sms-policy-links">
          Read our{" "}
          <Link href="/terms#sms" target="_blank" rel="noopener noreferrer">
            Terms & Conditions
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </Link>
          . <Link href="/support">Contact support</Link>.
        </p>
        <button
          className="button primary"
          type="submit"
          disabled={
            busy ||
            !user?.emailVerified ||
            !tenant ||
            !consent ||
            !agreed ||
            !phone.trim()
          }
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={16} /> Saving…
            </>
          ) : (
            "Save my SMS consent"
          )}
        </button>
        <p className="helper">
          Only you can opt in for your account. Your company administrator
          cannot consent for you.
        </p>
      </form>
    </div>
  );
}

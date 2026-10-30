import Link from "next/link";
import { Ghost, ArrowLeft } from "lucide-react";
import policy from "@/lib/messaging-policy";

export function PolicyLinks() {
  return (
    <nav className="policy-links" aria-label="Policies">
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
      <Link href="/sms">SMS preferences</Link>
      <Link href="/support">Support</Link>
    </nav>
  );
}
export function PolicyShell({
  title,
  eyebrow = "GHOSTAI",
  children,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="policy-page">
      <header className="policy-header">
        <Link className="policy-brand" href="/">
          <Ghost size={24} />
          GhostAI
        </Link>
        <Link className="policy-back" href="/">
          <ArrowLeft size={16} /> Back to app
        </Link>
      </header>
      <main className="policy-card">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {children}
      </main>
      <footer className="policy-footer">
        <span>GhostAI by {policy.operator}</span>
        <PolicyLinks />
      </footer>
    </div>
  );
}

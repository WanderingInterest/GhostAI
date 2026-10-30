import type { Metadata } from "next";
import Link from "next/link";
import { PolicyShell } from "@/components/policy-shell";
import { supportEmail } from "@/lib/messaging-policy";
export const metadata: Metadata = { title: "Support | GhostAI" };
export default function SupportPage() {
  return (
    <PolicyShell title="How can we help?">
      <p>
        For account access, job permissions, or company records, contact your
        company administrator using your usual work contact.
      </p>
      <section>
        <h2>GhostAI support & privacy requests</h2>
        {supportEmail ? (
          <p>
            Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>. Include
            your company name and the issue you need help with. Do not send
            passwords or API keys.
          </p>
        ) : (
          <p>
            The public support email is being prepared for launch. Existing
            pilot participants can use their established contact with Wandering
            Interest. For company-controlled records, contact your company
            administrator.
          </p>
        )}
      </section>
      <section>
        <h2>SMS preferences</h2>
        <p>
          You can withdraw consent in <Link href="/sms">SMS preferences</Link>.
          When SMS is enabled, reply STOP to opt out or HELP for assistance.
          Message and data rates may apply.
        </p>
      </section>
      <p>
        <Link href="/">Return to GhostAI</Link>
      </p>
    </PolicyShell>
  );
}

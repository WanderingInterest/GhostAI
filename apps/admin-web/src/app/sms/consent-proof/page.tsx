import type { Metadata } from "next";
import Link from "next/link";
import { PolicyShell } from "@/components/policy-shell";
import policy, { smsNumber, supportEmail } from "@/lib/messaging-policy";
export const metadata: Metadata = { title: "SMS consent process | GhostAI" };
export default function ConsentProofPage() {
  return (
    <PolicyShell title="How technicians opt in" eyebrow="SMS CONSENT PROCESS">
      <p className="policy-date">
        {policy.program} · Version {policy.version}
      </p>
      <p>
        This page documents the implemented web opt-in process for{" "}
        {policy.sender}
        {smsNumber ? ` at ${smsNumber}` : ""}. It is a description of the
        workflow, not a claim that a particular person has consented or that the
        number is approved to send texts.
      </p>
      <section>
        <h2>Purpose and audience</h2>
        <p>
          The program supports enrolled service technicians with job
          information, responses to their requests, service-note confirmations,
          and repair-approval updates. It does not send marketing or unsolicited
          customer outreach.
        </p>
      </section>
      <section>
        <h2>The actual enrollment flow</h2>
        <ol>
          <li>
            The technician creates or signs in to their own GhostAI account and
            verifies their email.
          </li>
          <li>
            They join their company through an invitation or create a company.
            Joining does not opt them into SMS.
          </li>
          <li>
            They open <Link href="/sms">SMS preferences</Link>, enter their own
            mobile number, and read the disclosure below and its linked
            policies.
          </li>
          <li>
            They voluntarily select an SMS checkbox that is unchecked by
            default, then choose “Save my SMS consent.” They may instead leave
            without enrolling and continue using the web app.
          </li>
          <li>
            The authenticated backend records their choice and the policy
            version. Phone ownership remains unverified; consent alone cannot
            activate messaging.
          </li>
        </ol>
        <p>
          <Link className="button primary" href="/sms">
            View the actual consent form
          </Link>
        </p>
      </section>
      <section>
        <h2>Exact consent disclosure</h2>
        <blockquote className="consent-quote">{policy.disclosure}</blockquote>
        <p>
          The form links directly to the{" "}
          <Link href="/terms#sms">Terms & Conditions</Link>,{" "}
          <Link href="/privacy">Privacy Policy</Link>, and{" "}
          <Link href="/support">support</Link>. The checkbox is separate from
          account creation and general terms.
        </p>
      </section>
      <section>
        <h2>Evidence retained privately</h2>
        <p>
          For an actual opt-in, GhostAI records the authenticated user and
          company, submitted phone number, server timestamp, affirmative
          checkbox action, disclosure text, policy versions and links, source
          page and request origin, and an immutable consent event. Withdrawals
          create a separate event. No real technician phone numbers or private
          consent records are published on this page.
        </p>
      </section>
      <section>
        <h2>Withdrawal and messaging readiness</h2>
        <p>
          Technicians can withdraw in SMS preferences without losing their web
          account. STOP and HELP processing, phone verification, signed Twilio
          webhooks, and outbound dispatch are separate messaging integration
          work. Live SMS must remain disabled until those controls and number
          verification are complete. This page does not claim they are already
          active.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          {supportEmail ? (
            <>
              Contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a> for
              program questions.
            </>
          ) : (
            <>
              Contact details are available on the{" "}
              <Link href="/support">support page</Link>.
            </>
          )}
        </p>
      </section>
    </PolicyShell>
  );
}

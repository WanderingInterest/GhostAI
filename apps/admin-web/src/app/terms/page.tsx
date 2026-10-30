import type { Metadata } from "next";
import Link from "next/link";
import { PolicyShell } from "@/components/policy-shell";
import policy, { supportEmail, smsNumber } from "@/lib/messaging-policy";
export const metadata: Metadata = { title: "Terms & Conditions | GhostAI" };
export default function TermsPage() {
  return (
    <PolicyShell title="Terms & conditions">
      <p className="policy-date">
        Effective October 29, 2026 · Version {policy.version}
      </p>
      <p>
        These terms govern GhostAI, operated by {policy.operator}. By creating
        an account or using the service, you agree to these terms. Our{" "}
        <Link href="/privacy">privacy policy</Link> explains how information is
        handled. SMS consent is a separate, optional choice.
      </p>
      <section>
        <h2>The service</h2>
        <p>
          GhostAI helps authorized service teams look up work, capture notes,
          and request permitted actions. Available features depend on your
          company’s configuration, permissions, provider connections, and
          release stage. Demo CRM actions affect demo records. We do not
          represent a demo action as an update to external business software.
        </p>
      </section>
      <section>
        <h2>Accounts and authorized use</h2>
        <p>
          You must be at least 18 and authorized to use the account and business
          information you provide. Keep credentials private and report suspected
          misuse. Company owners manage invitations, permissions, assignments,
          and connected accounts. Do not use GhostAI for unlawful activity,
          unsolicited messages, attempts to access another company’s records, or
          actions you are not authorized to perform.
        </p>
      </section>
      <section>
        <h2>AI responses and business actions</h2>
        <p>
          AI responses can be inaccurate or incomplete. A conversational
          statement alone is not proof that a business action occurred; use the
          recorded action receipt. Sensitive actions may require owner approval.
          GhostAI does not replace professional judgment and must not be relied
          on for emergencies or safety-critical instructions. Call emergency
          services directly when needed.
        </p>
      </section>
      <section>
        <h2>Connected services and charges</h2>
        <p>
          Your company remains responsible for its connected Twilio, OpenAI, and
          other provider accounts, permissions, usage, and charges. Provider
          terms also apply. Separate subscription or commercial terms, if
          agreed, govern GhostAI fees. A connected account or number does not
          guarantee provider approval, uninterrupted availability, or message
          delivery.
        </p>
      </section>
      <section id="sms">
        <h2>SMS program: {policy.program}</h2>
        <p>
          The sender is {policy.sender}
          {smsNumber ? ` (${smsNumber})` : ""}. The program supports enrolled
          technicians with replies to their requests, job information,
          service-note confirmations, and repair-approval updates. It is not a
          marketing or unsolicited customer outreach program.
        </p>
        <ul>
          <li>
            <strong>Opt-in:</strong> Enter your own mobile number and select the
            separate, unchecked consent box in{" "}
            <Link href="/sms">SMS preferences</Link>. Account access and web app
            use remain available without SMS consent. A recorded preference does
            not activate SMS until phone ownership and the messaging connection
            are verified.
          </li>
          <li>
            <strong>Frequency:</strong> Message frequency varies based on your
            activity and requested work updates.
          </li>
          <li>
            <strong>Charges:</strong> Message and data rates may apply. Contact
            your wireless provider about your plan.
          </li>
          <li>
            <strong>Opt-out:</strong> Reply STOP to stop program messages when
            SMS is enabled. A final opt-out confirmation may be sent. You can
            also withdraw in SMS preferences. Renewed enrollment requires a new
            affirmative opt-in.
          </li>
          <li>
            <strong>Help:</strong> Reply HELP when SMS is enabled, or{" "}
            {supportEmail ? (
              <>
                email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
              </>
            ) : (
              <>
                visit <Link href="/support">support</Link>
              </>
            )}
            .
          </li>
          <li>
            <strong>Delivery:</strong> Wireless carriers are not liable for
            delayed or undelivered messages. SMS is not guaranteed or suitable
            for emergencies.
          </li>
          <li>
            <strong>Privacy:</strong> Mobile numbers and SMS opt-in data are not
            sold or shared for third-party marketing. Read the{" "}
            <Link href="/privacy">privacy policy</Link>.
          </li>
        </ul>
        <p>
          Only enroll a number you control. Tell your company administrator if
          you lose access to it. A company invitation or permission assignment
          does not itself provide SMS consent.
        </p>
      </section>
      <section>
        <h2>Your information and service operation</h2>
        <p>
          You retain your rights in the information you provide and authorize us
          to process it to deliver and secure the service. Do not submit
          information you lack permission to use. We may restrict access for
          misuse, security incidents, provider restrictions, or nonpayment under
          applicable commercial terms. You can stop using the service and
          request account assistance through support.
        </p>
      </section>
      <section>
        <h2>Availability and responsibility</h2>
        <p>
          To the extent permitted by applicable law, the service is provided as
          available without a guarantee of error-free operation, uninterrupted
          access, or fitness for a particular purpose. You remain responsible
          for business decisions and authorized actions. Nothing in these terms
          excludes rights or liability that cannot lawfully be excluded.
        </p>
      </section>
      <section>
        <h2>Changes and contact</h2>
        <p>
          We may update these terms as the service develops and will identify
          the current effective date. Material changes will be communicated
          through the service where appropriate. For service questions, SMS
          help, or account requests, use <Link href="/support">support</Link>.
        </p>
      </section>
    </PolicyShell>
  );
}

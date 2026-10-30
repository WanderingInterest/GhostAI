import type { Metadata } from "next";
import Link from "next/link";
import { PolicyShell } from "@/components/policy-shell";
import policy, { supportEmail } from "@/lib/messaging-policy";
export const metadata: Metadata = { title: "Privacy Policy | GhostAI" };
export default function PrivacyPage() {
  return (
    <PolicyShell title="Privacy policy">
      <p className="policy-date">
        Effective October 29, 2026 · Version {policy.version}
      </p>
      <p>
        GhostAI is operated by {policy.operator}. This policy explains how we
        handle information when you use our business assistant, web app, and,
        when enabled, SMS messaging program.
      </p>
      <section>
        <h2>Information we collect</h2>
        <p>
          We collect account information such as your email, name, company
          membership, and access permissions. We store the business records you
          provide, including customer and property details, jobs, notes, repair
          requests, conversations, approvals, and action receipts. If you choose
          SMS, we collect your phone number, consent choices, and records of
          when and how those choices were made. When messaging is enabled, we
          also process messages, delivery events, and opt-out requests.
        </p>
        <p>
          We keep security and operational records needed to authenticate
          accounts, enforce permissions, prevent duplicate actions, and diagnose
          failures. Connected service credentials are stored encrypted on the
          backend.
        </p>
      </section>
      <section>
        <h2>How we use information</h2>
        <p>
          We use this information to provide the assistant, manage accounts,
          retrieve permitted business information, carry out authorized actions,
          deliver requested messages, maintain consent records, and protect the
          service. Your company controls technician access and the business
          records it enters into GhostAI.
        </p>
      </section>
      <section>
        <h2>Service providers and company access</h2>
        <p>
          We use Google Firebase for authentication, backend processing, and
          data storage. When the assistant is used, relevant conversation
          context and permitted tool results are sent to OpenAI to generate
          responses. Twilio processes phone numbers, messages, and delivery
          information when SMS is enabled. Hosting providers, including Vercel
          when deployed there, process requests needed to serve the app.
          Connected business providers receive information necessary for actions
          you authorize.
        </p>
        <p>
          Your company’s authorized users can access shared business records
          according to their permissions. These arrangements do not authorize
          providers or other businesses to use SMS consent for their own
          marketing.
        </p>
      </section>
      <section>
        <h2>SMS privacy and consent</h2>
        <p>
          We do not sell or rent personal information. Mobile numbers, SMS
          opt-in data, and consent are not sold or shared with third parties or
          affiliates for marketing, advertising, or lead generation. Text
          messaging originator opt-in data and consent are excluded from other
          information-sharing categories and are not shared with third parties
          for their own purposes. Providers may process the minimum information
          necessary to deliver and operate the messaging program on our behalf.
        </p>
        <p>
          SMS is optional. You can withdraw consent in{" "}
          <Link href="/sms">SMS preferences</Link> and, once messaging is
          enabled, by replying STOP. Withdrawing SMS consent does not close your
          account or prevent use of the web app. We retain evidence of consent
          and withdrawal as needed to honor your choices and meet applicable
          obligations.
        </p>
      </section>
      <section>
        <h2>Storage, retention, and security</h2>
        <p>
          We restrict access by company and role and use encrypted transport and
          backend protections. No system can guarantee absolute security.
          Information is retained for as long as reasonably needed to provide
          the service, maintain accurate business and consent records, resolve
          disputes, and meet legal or security obligations. Deleting an active
          record may not immediately remove retained backups or provider
          records. We do not promise automatic deletion on a fixed schedule.
        </p>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>
          You can update supported account and business information in the app.
          Contact your company administrator to request access, correction,
          export, or deletion of company-controlled records. For requests
          concerning GhostAI’s handling of your personal information,{" "}
          {supportEmail ? (
            <>
              email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
            </>
          ) : (
            <>
              use the contact instructions on our{" "}
              <Link href="/support">support page</Link>
            </>
          )}
          . Some records may need to be retained for security, consent evidence,
          or legal obligations.
        </p>
      </section>
      <section>
        <h2>Cookies and local storage</h2>
        <p>
          The app uses browser storage to maintain sign-in sessions and
          conversation state. Hosting and infrastructure providers may process
          technical connection information to operate and secure the service.
          GhostAI does not currently enable advertising trackers or Firebase
          Analytics.
        </p>
      </section>
      <section>
        <h2>Changes and contact</h2>
        <p>
          We will update the effective date when this policy changes. Material
          changes to SMS consent will be presented before requesting new
          consent. See <Link href="/support">support</Link> for contact options.
          GhostAI is a business service and is not intended for children under
          18.
        </p>
      </section>
    </PolicyShell>
  );
}

# Public policies and SMS consent

The public pages are ready in the Next.js app:

| Path | Purpose |
| --- | --- |
| `/privacy` | Privacy policy, including SMS opt-in data and service providers |
| `/terms` | Terms & Conditions, with the SMS program at `#sms` |
| `/sms` | The real technician self-service opt-in and withdrawal form |
| `/sms/consent-proof` | Public explanation of that flow and exact disclosure |
| `/support` | Support and privacy request contact instructions |

These pages require no sign-in to read. Saving a preference requires the user's own
verified Firebase identity and active company membership. Account creation and use
of the web app do not require SMS consent. Owners cannot opt in for a technician.

## Before publishing

The operator currently reads **Wandering Interest**, with **GhostAI Technician
Assistant** as the program and **GhostAI by Wandering Interest** as the sender.
Confirm that this matches the business identity submitted for this Twilio number.
Set the actual support contact and assigned Twilio number in the frontend's Vercel
environment, then build/deploy the frontend:

```text
NEXT_PUBLIC_SUPPORT_EMAIL=<your monitored support email>
NEXT_PUBLIC_SMS_NUMBER=<your assigned toll-free number>
```

The support page explicitly identifies an unset contact as being prepared for launch;
replace that state before submitting verification. No support mailbox or business
identity has been invented. Review the policy copy against actual business practices
and any separate commercial agreements before publishing.

Deploy the updated Functions using `npm run deploy:backend` yourself. Add the exact
frontend origin to backend CORS and the required Firebase Auth authorized domains.
Local preferences are emulator data and are not live consent records. No deployment
or Twilio submission has been performed by the agent.

## Verification submission

After hosting, use URLs on your actual domain:

- Privacy Policy: `https://<your-domain>/privacy`
- Terms & Conditions: `https://<your-domain>/terms`
- Opt-in form: `https://<your-domain>/sms`
- Documented consent process: `https://<your-domain>/sms/consent-proof`

The proof page links to the actual form; it is not a fabricated record of consent
or an assertion of Twilio approval. If the reviewer requests an image, capture the
actual `/sms` form with its checkbox unchecked and all disclosure/policy links visible,
host that image publicly, and submit its URL. Use blank or redacted personal fields.
No private consent records should be published.

Suggested use-case description, if it accurately describes your intended program:

> Internal SMS assistant for enrolled service technicians. Technicians request job
> information, record service notes, and request repairs. Replies contain requested
> information, saved-action confirmations, and approval status. No marketing or
> unsolicited customer outreach.

Do not claim STOP/HELP webhooks or phone verification are already live. The published
proof page accurately distinguishes the implemented consent flow from pending SMS
transport work. Provider approval is determined by Twilio, not by these pages.

## Consent record and integration boundary

The backend endpoint is `GET/POST /orgs/{tenant}/messaging-consent`. A POST accepts
only an `opt_in` with an affirmative checkbox, current policy version, own phone,
idempotency key and expected revision, or a `withdraw` with the key and revision.
The identity always comes from the bearer token; there is no target-user field.

Current preference: `organizations/{tenant}/messagingConsents/{uid}`.
Immutable events: `.../messagingConsents/{uid}/events/{requestKey}`.

Events retain authenticated actor/company, phone, server timestamp, source path and
request origin, exact disclosure, privacy/terms versions and paths, affirmative
checkbox state, and subsequent withdrawal. Replay does not restore withdrawn consent;
revision checks prevent a stale request from overwriting a newer choice. Browser
Firestore access remains denied.

The canonical public consent text/version is `functions/src/messaging-policy.json`,
imported by the backend and frontend. This file contains public copy only. Update
and version it deliberately when disclosures change.

A saved preference is **consented_pending_verification**, with `phoneVerified=false`
and `smsEnabled=false`. It is not an enrolled, verified phone identity. The later
Twilio adapter must verify number ownership, bind it to the correct account and
company, implement signed webhooks and STOP/HELP, and check current consent both
when queueing and immediately before outbound dispatch. Withdrawing here must also
block future queued messages once that adapter exists.

This initial program identifies GhostAI/Wandering Interest as the sender. Future
customer-owned Twilio programs need tenant-specific sender identity, number, approved
use case and matched consent/policy versions before activation; this consent must
not be reused as blanket permission for unrelated businesses or marketing.

## References checked

- [Twilio toll-free onboarding](https://help.twilio.com/hc/en-us/articles/13264118705051-Required-Information-for-Toll-Free-Verification)
- [Explicit SMS disclosure](https://www.twilio.com/docs/api/errors/30551)
- [Direct end-user consent](https://www.twilio.com/docs/api/errors/30552)
- [Optional opt-in](https://www.twilio.com/docs/api/errors/30505)

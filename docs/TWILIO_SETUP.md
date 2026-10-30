# SMS: assisted company onboarding

Each company brings its own Twilio account and SMS-capable number. GhostAI operators
connect it during customer onboarding. The app shows connection status and the number;
company owners can enter customer Twilio details in **Connections → Text messaging** during assisted onboarding. Technicians never see these settings. OpenAI remains a separate
connection. No credentials or numbers have been configured by this change.

## In-app assisted setup

Sign in as a company owner and open **Connections → Text messaging**. Enter the
Twilio business number, Account SID, Auth Token, business sender name and support
email. Check the approval confirmation only when sender registration is approved;
leave it unchecked to save a pending connection with messaging off. Save verifies
number ownership and configures the inbound webhook. Setup requires recent sign-in.
Credentials are encrypted and never returned to the browser. Use **Update connection**
to rotate credentials or confirm approval, and **Disconnect** before changing number.
The form is disabled in emulator previews.

Deploy the backend with `npm run deploy:backend` and deploy the updated frontend to
Vercel before using this form. Operator CLI setup below remains available as an alternative.

## Operator CLI setup

1. Deploy the backend with `npm run deploy:backend`. This now includes `api`,
   `twilioWebhook`, `smsIncoming`, and `smsOutgoing`, plus Firestore rules/indexes.
   Firestore triggers use Eventarc; the Firebase deployment must enable its APIs and
   service-agent permissions. First-time provisioning can require a deployment retry.
2. Deploy the frontend to Vercel. Primary URL: `https://www.ghostai.dev`.
3. Use operator Application Default Credentials with access to this project's
   Firestore and Secret Manager. For local operator setup, use
   `gcloud auth application-default login`. Never put operator credentials in the browser.
4. Obtain the company's ID from Firestore `organizations/{companyId}` and securely
   collect its Twilio Account SID, Auth Token, and business number. The Auth Token
   authenticates provider requests and validates incoming signatures; a number alone
   is insufficient. Dedicated customer accounts/subaccounts are preferred.
5. Create a private JSON file outside the repository, `chmod 600` it, and fill in:

```json
{
  "accountSid": "AC...",
  "authToken": "...",
  "phone": "+16025550123",
  "sender": "Customer Business Name",
  "supportEmail": "support@customer.example",
  "approvedForMessaging": false
}
```

6. Run `npm run setup:twilio -- COMPANY_ID /absolute/path/private-twilio.json`.
   This validates number ownership and SMS capability, encrypts credentials using the
   existing vault key with tenant/provider binding, reserves the account/number for
   this company, and configures its inbound POST webhook. It prints no secrets.
   Remove the private input file after secure handoff/storage is complete.
7. After confirming the actual sender registration/verification is approved for the
   intended destination/use case, rerun with `approvedForMessaging: true`. This flag is
   an explicit operator attestation, **not an automated provider compliance check**.
   Failed provider configuration leaves messaging disabled. Verify Twilio's configured
   webhook is the URL printed by the command; avoid alternate Cloud Run URLs, proxy
   rewrites, query strings, and trailing slashes because signatures bind the exact URL.
8. Verify the company's legal sender, support contact, privacy/terms coverage, and
   consent evidence match its Twilio submission. If Advanced Opt-Out is enabled,
   configure its HELP response with the same sender/support information. Twilio
   normally handles STOP confirmation; GhostAI also records withdrawal and blocks
   future actions/sends. START never restores GhostAI consent by itself.

Only public connection metadata is exposed to company owners. Credentials have no
read-back endpoint. Setup and disconnect are audited. To change a number/account,
first disconnect through the owner-authenticated API (`POST
/orgs/{companyId}/connections/twilio/disconnect`, `{}`; recent sign-in required), then
rerun operator setup. Remove obsolete webhook configuration in the old Twilio account.
The server rejects callbacks after disconnect, and queued messages cannot use the
removed credentials. Credential rotation on the same account/number uses the same
setup command. Replacing configuration invalidates messages queued under the old
connection generation.

## Technician enrollment

The technician signs in, verifies their email, and joins their company. From account
SMS preferences (`/sms?company=COMPANY_ID`), they enter their own phone, read the
company's sender-specific disclosure, and select the initially unchecked optional
consent box. They then choose **Verify my phone**, which displays a one-time LINK
message and the company's number, with a mobile SMS link. Sending that exact message
from the consented phone proves ownership. Codes expire after ten minutes, are stored
as hashes, and are bound to the user's current consent revision and phone. A new code
invalidates the previous one. “I sent it — check status” confirms enrollment.

The company sender, support email and number determine the versioned disclosure.
Changing any of those requires fresh consent and verification. Old pilot consent
cannot enable a different company's messaging program. Owners cannot opt in for
technicians. Consent is optional and has no effect on web access.

The public `/privacy`, `/terms`, `/support`, `/sms`, and `/sms/consent-proof` pages
remain available. The proof page describes the process and pilot disclosure; it
never publishes private evidence or claims provider approval. Actual authenticated
forms display the selected company's disclosure. Keep public pilot contact settings
`NEXT_PUBLIC_SUPPORT_EMAIL` and `NEXT_PUBLIC_SMS_NUMBER` accurate before using them
in a GhostAI pilot verification submission.

## Runtime and controls

- Signed inbound URL: `https://us-central1-ghostai-794c5.cloudfunctions.net/twilioWebhook/COMPANY_ID/inbound`.
  The SDK verifies all received form parameters against the canonical URL and the
  tenant's Auth Token. Account SID and destination must also match. No host header,
  model output, or sender-supplied tenant identifier determines routing.
- Incoming provider Message SIDs are durable idempotency keys in `smsInbox`.
  Firestore creation triggers process messages asynchronously, acknowledging the
  webhook before model work. Unknown/unverified senders cannot reach the assistant.
  HELP provides sender/support information without exposing business data. Duplicate
  requests cannot repeat actions. Only text is processed; no attachment/voice support.
- The existing Executive runtime uses the current user's scoped tools, membership,
  account status, action receipts and quotas. SMS additionally checks current consent,
  verified phone binding and connection generation before every tool and response.
  Conversations are separate per user/company/enrollment/connection. Pending approval
  actions remain pending and must be approved in the portal.
- Replies enter `smsOutbox`; dispatch rechecks account, membership, consent and
  connection before Twilio. Automatic provider retries are off. A timeout or crash
  after claiming a send is never blindly resent. Signed status callbacks persist
  provider SID and delivery/failure state. Provider acceptance is not delivery.
- STOP updates an immutable withdrawal event and blocks the phone, including while
  a connection is paused. Web withdrawal/re-enrollment invalidates queued requests
  through consent revisions. After STOP, a new web opt-in and phone verification are
  required (and the recipient may need START to clear Twilio's independent block).
- Keep SMS concise; replies are capped at 1,400 characters and may span multiple
  billed segments. Input is limited to 2,000 characters. No marketing, unsolicited
  customer outreach, automatic approval notifications or delivery retries are built.

## Operations and critical validation

Inspect company `smsInbox`/`smsOutbox` records for failed or stuck work. `processing`,
`sending`, or `unknown` after an interrupted invocation requires manual reconciliation
against assistant turn receipts and Twilio logs. **Do not reset these to queued or
replay CRM writes.** Use the saved receipts to determine what committed and the Twilio
message/callback records to determine delivery. Durable storage makes failures
inspectable; this prototype does not yet include an operator recovery dashboard,
automated recovery, conversation retention jobs, or number-reassignment automation.
A phone can belong to only one account within a company until an operator reviews and
removes the old binding; phone possession alone must not transfer historical access.

Critical emulator checks cover signature rejection, tenant isolation, current disclosure,
phone ownership, duplicate action/send prevention, STOP suppression, START behavior,
HELP and callback recipient binding. They use injected provider/model boundaries and
send no real SMS or paid model calls. After actual onboarding, perform one live
technician job lookup/note and STOP check with the approved number before launch.

References: [Twilio security](https://www.twilio.com/docs/usage/security),
[Message API and callbacks](https://www.twilio.com/docs/messaging/api/message-resource),
[toll-free verification](https://www.twilio.com/docs/api/errors/30032),
[A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc).

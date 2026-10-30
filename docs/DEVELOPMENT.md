# Local Executive assistant

See [Executive setup and integration boundaries](EXECUTIVE.md). Use `npm run demo:assistant` for the complete local stack, or reuse running emulators with `npm run seed` and `npm run dev:emulator`. Configure the key with `npm run setup:assistant -- /path/to/key-file.txt`; it is restricted to the seeded demo company. Model calls use OpenAI while CRM changes remain in emulators. The updated runtime has not been deployed to Firebase.

# Next.js and Firebase workspace

The primary app is now `apps/admin-web` (Next.js App Router, TypeScript). The backend
is `functions` (Cloud Functions for Firebase, TypeScript, Firebase Admin SDK and Zod).
The original Python prototype is retained as a reference; it is not the new app backend.

## Run locally

Use Node 24.12+ and Java 21. From the repository root:

```sh
npm ci
cp .env.example apps/admin-web/.env.local
npm run emulators
```

In another terminal:

```sh
npm run seed
npm run dev
```

Open http://127.0.0.1:3000 and select **Open demo workspace**. The seed command uses
only `demo-ghostai` and explicit loopback emulator addresses. It cannot seed the live
project. Local emulator data resets on restart; run seed again when needed.

For a smaller Java heap, start emulators with
`JAVA_TOOL_OPTIONS=-Xmx512m npm run emulators`.

Demo accounts (emulator only):

- Owner: `owner@demo.ghostai.test`
- Technician: `alex@demo.ghostai.test`
- Password for both: `DemoOnly-2026!`

Email verification/reset links from emulator accounts are printed by the Auth
emulator. The production app has no demo sign-in button. Local mode is explicitly
selected by `NEXT_PUBLIC_USE_EMULATORS=true`; it uses project `demo-ghostai`, while
live mode uses the supplied `ghostai-794c5` configuration. Analytics is not initialized.

## Everyday workflows

- **Customers:** create/edit customer contacts; add/edit multiple properties for each.
- **Jobs:** create/edit a scheduled visit, change its status, capture service notes,
  request a repair, and mark approved repairs resolved.
- **Team:** invite a technician with operation permissions and job assignments,
  change access later, pause access or cancel an unused invitation.
- **Approvals:** review the exact repair details and approve/decline in one action.
- **Overview:** current job counts, upcoming work, pending approval and recent results.

Invitations are generated as copyable links, valid for seven days and bound to the
verified invited email. Sending email invitations automatically is not implemented.
Company creation is idempotent per owner account. Access is rechecked in every backend
transaction. Updating a technician's permissions/assignments increments an authorization
version, invalidating their queued repair proposals. Declined/expired proposals require
a new request; approval decisions cannot be replayed. Firebase account disablement and
token revocation are checked on API calls and requester validity is checked before
approval execution. Recent authentication is required for owner administration.

Browser authentication uses the Firebase SDK's session persistence and ID tokens over
HTTPS in live mode, rather than the legacy access codes. MFA is out of scope by the owner’s decision. Recent password confirmation protects sensitive account and connection changes; phone-channel identity remains separate future work. Tokens and invitation secrets
must not be logged. There is no client Firestore or Storage business access: rules deny
it by default, while Functions explicitly authorize Admin SDK access.

The demo CRM is backed by real local Firestore documents and supports useful basic
record management; it is not an external CRM connector. Native writes, demo changes,
receipts, conversations and sanitized audit events commit in Firestore transactions.
No provider call happens inside a transaction callback. No SMS, voice, live CRM or attachments are connected yet. Owner-only OpenAI credential validation is implemented for live mode; it lists models without generating content.

## Critical checks

```sh
npm run typecheck
npm test
npm run build
```

`npm test` runs only critical auth, data persistence/idempotency, tenant isolation,
permission revocation and approval paths in fresh emulators. Stop a separately running
emulator suite first to avoid port conflicts. `npm run test:full` remains available
for changes that justify broader verification; it is not the default. CI runs the
critical checks. Repeating unchanged checks and broad simulations is unnecessary.

The workspace lockfile uses explicit patched transitive overrides for grpc-js,
OpenTelemetry core and uuid; the dependency audit was clean after installation.

## Live Firebase connection

Project setup confirmed by the owner:

- Project ID: `ghostai-794c5`.
- Email/Password authentication enabled.
- Cloud Firestore database: `(default)`, multi-region `nam5`.
- Functions region: `us-central1`, matching Firebase's recommended pairing for `nam5`.

## Deploy the backend yourself

Blaze is confirmed. The frontend will be hosted on Vercel; this command does not
publish or configure a frontend. From the repository root:

```sh
npm run deploy:backend
```

The command uses the Firebase CLI login already on this machine, checks the exact
project `ghostai-794c5`, preserves an existing enabled `GHOSTAI_VAULT_KEY`, or creates
it **only when Firebase reports that the secret does not exist**. It then deploys
Functions, Firestore rules and indexes. It never replaces an existing vault key on
an authentication/network error. Temporary key material has owner-only file permissions
and is removed after upload; the key is never printed. Review the deploy script before
running it if desired. No deployment has been executed by the agent.

`functions/.env.ghostai-794c5` contains the exact localhost origins for initial live
use. On another checkout, copy `functions/.env.example` to that filename first.
For Vercel later, add your exact `https://…vercel.app` or custom production origin
there and redeploy Functions. Wildcard Vercel origins are not accepted.

The final backend runs on Node 24 in `us-central1`; the default Firestore database
is in `nam5`. Its runtime identity needs Firestore access and Firebase Auth user
read/update permissions (for token checks and revocation). Firebase deployment binds
the named vault secret to the function. If project IAM policies removed standard
runtime permissions, grant the function runtime service account Cloud Datastore User
and Firebase Authentication Admin in Google Cloud IAM before using the app. Do not
put a service-account key in frontend configuration.

After deploying, stop the local preview and run:

```sh
npm run dev:live
```

This command explicitly overrides emulator mode, even if an old `.env.local` enabled
it. New accounts now appear in the live Firebase Auth console and verification/reset
emails use Firebase’s real email service. The local demo accounts do not transfer.

## Vercel deployment

- Root Directory: `apps/admin-web`; Framework: Next.js; Node: 24.
- Enable **Include source files outside of the Root Directory in the Build Step**.
  The public messaging policy JSON is shared with the Functions workspace.
- The checked-in frontend `vercel.json` installs with `npm ci --include=dev` and builds
  only Next.js with emulator mode disabled. Clear any dashboard override that builds
  from the repository root; the root build also compiles Firebase Functions.
- TypeScript and React/Node type packages are declared directly in the frontend
  workspace, so a Vercel workspace install includes the compiler required by Next.js.
- Both package manifests pin Node to `24.x`. The old open-ended `>=24.12.0`
  range allowed Vercel to select Node 26, which caused dependency engine warnings.
- Environment: `NEXT_PUBLIC_USE_EMULATORS=false` and
  `NEXT_PUBLIC_FUNCTIONS_REGION=us-central1`.
- Add the final domain in Firebase Auth → Settings → Authorized domains.
- Add the exact HTTPS origin to `GHOSTAI_ALLOWED_ORIGINS` and redeploy the backend.
- No server credentials or vault key are needed in Vercel.

The `EBADENGINE` and npm `cache-dir` warnings do not by themselves identify a failed
build. If deployment still fails, inspect the final `Error`/`npm error` lines and the
exit status. The first deployment after changing these settings should use the latest
commit and a fresh build cache.

For live localhost auth links, add `localhost` and `127.0.0.1` to Firebase Auth’s
Authorized domains if absent. A successful signup sends a verification email;
creating a company and accepting invitations require verified identity. Invitation
links are still copied/shared by the owner; automatic invitation email is not added.

## OpenAI credentials and account controls

The Connections screen lets an owner save, replace, check or disconnect a project API
key. The backend validates it with `GET /v1/models` (model-list read access required),
then encrypts it using AES-256-GCM with a random IV and company/provider-bound
additional authenticated data. The ciphertext and status live in a server-only
`organizations/{tenantId}/privateCredentials/openai` document. The vault encryption
key lives in Firebase Secret Manager and is bound only to the backend. No API route,
workspace snapshot, receipt or audit event returns the stored key or ciphertext.

Replacement atomically replaces the stored ciphertext. Disconnect removes it from the
active document; Firestore backups may retain historical ciphertext. Owners revoke
old keys in OpenAI themselves. A check that overlaps rotation/disconnect cannot overwrite
the newer connection. A successful check proves model-list access, not paid inference
permissions, available balance or a hard spending cap. Connections are disabled in
emulator previews so real keys cannot be stored under the known local-only vault key.

**Do not rotate/destroy the vault encryption key with a normal secret-set command:**
existing ciphertext must first be migrated under a new key. The deployment script
preserves it intentionally. Customer API keys can be replaced normally through the UI.

Account settings provide password reset and sign-out on all devices. Firebase validates
revocation at API ingress. Technician permission changes remain company-scoped and
invalidate pending approvals through the membership authorization version. MFA is
not required or implemented, as requested.

Storage stays optional and closed. Public-endpoint quotas, monitoring and configurable
retention remain pilot hardening work. List snapshots are bounded to 500 documents per
collection; pagination is needed before larger pilots. No live records or provider
keys have been created by local checks. Final live enrollment verification follows
your deployment.

Official references:

- [Functions region pairing](https://firebase.google.com/docs/functions/locations)
- [Functions deployment requirements](https://firebase.google.com/docs/functions/get-started)
- [Server SDK authorization boundary](https://firebase.google.com/docs/firestore/security/rules-conditions)

# Firebase architecture decision

Selected by the project owner on 2026-10-29. This replaces the earlier PostgreSQL
production proposal. The Next.js app and TypeScript Functions backend are implemented against local Firebase emulators. The earlier SQLite prototype remains a reference. The live project is `ghostai-794c5`, database `(default)` in `nam5`, with Functions in `us-central1`. No live deployment has been performed. See [Development guide](DEVELOPMENT.md).

## Services

| Responsibility | Selected service |
| --- | --- |
| Owner and technician identity | Firebase Authentication |
| Tenant business records, permissions, proposals, approvals, receipts and audit | Cloud Firestore |
| HTTP API, Twilio webhooks, Gateway and bounded event/job handlers | Cloud Functions for Firebase |
| Private photos and attachments, when implemented | Cloud Storage for Firebase |
| Provider API secrets | Google Cloud Secret Manager; KMS where envelope encryption is needed |
| Later live phone audio bridge | Separate Cloud Run service |

Email/password authentication with email verification and password recovery is implemented.
MFA is excluded by the owner’s decision. Recent password confirmation protects owner
administration, session revocation and credential changes. The frontend is Vercel;
the backend remains Firebase Functions. Blaze is confirmed. The owner will run the
backend deployment command in [Development guide](DEVELOPMENT.md).

## Authorization boundary
Functions validate Firebase identity before invoking business logic. Resolve current
company membership using that identity and a validated company context. A supplied
company ID is only a selector until membership is checked. Verify token revocation
where required; sensitive operations also require recent authentication/step-up.

Use `organizations/{tenantId}/members/{uid}` for current membership, role, active flag,
permission grants and authorization version. Keep mutable permissions and assignments
in documents, so a stale token cannot preserve old grants. Custom claims may carry
coarse hints, but never substitute for current resource authorization.

Start with default-deny Firestore and Storage browser rules. The browser calls the
backend to read and modify business data. Client rules can later allow narrow reads
with dedicated tests, but must never allow edits to membership, approvals, execution
state or audit. **Admin SDK calls bypass Firestore Security Rules**: the Gateway must
check every server-side read/write and use narrowly scoped service identities.

## Persistence and execution
Tenant-owned collections live below `organizations/{tenantId}`. Requests, approvals,
notes, jobs, conversations and audit events retain explicit tenant ownership. Model
arguments cannot choose trusted identity. Record assignments and own/assigned/all
scopes retain their current meanings.

Use a deterministic request document ID derived from the tenant-scoped idempotency
key, and reject reuse with a different normalized proposal digest. Use transactions
to validate current membership/assignment, consume an approval, claim an execution
lease and create intent/outbox records. Represent approval decisions separately from
execution attempts and receipt state. Native Firestore-only writes can commit with
their authoritative receipt in a transaction.

Firestore may retry transaction callbacks. Keep callbacks limited to database reads
and writes: never send messages, call OpenAI or write to a CRM inside them. A worker
claims committed intent, performs final authorization checks before dispatch, and
calls the provider outside the transaction. Record lease owner/attempt and timestamps;
reject stale lease holders when finalizing. Permission changes block work not yet
dispatched; they cannot undo an external effect already in flight.

Use provider idempotency where supported. Reconcile ambiguous remote outcomes instead
of retrying writes blindly. Function/event delivery must be treated as repeatable;
deduplicate every handler. A Firestore transaction cannot atomically commit a remote
CRM write. Keep the shared result vocabulary and truthful simulated/provider receipts.

## Attachments and secrets
Enable Storage only when needed. Use tenant-specific private paths and an authenticated
backend authorization check for access. Any temporary download URL has a short lifetime;
record metadata/ownership in Firestore and validate size/type plus media safety before
use. Avoid public media links in audit or model context.

Customer API keys are accepted through the owner’s password input and sent only to the
authenticated backend. They are encrypted with AES-256-GCM and tenant/provider-bound AAD
in server-only Firestore documents. A stable vault encryption key is managed by Firebase
Secret Manager and bound to the backend. Never return plaintext or ciphertext to the
browser or include it in workspace/audit payloads. See the Development guide for
rotation and disconnect semantics.

## Deployment sequence
1. Select Firebase project IDs and region; use separate development and production projects.
2. Add Firebase configuration, Auth/Firestore/Functions emulators and rule tests.
3. Implement real sign-in and owner-issued invitations with atomic acceptance; preserve
   enrollment grants/assignments and immediate revocation behavior.
4. Replace the SQLite adapter with Firestore and run isolation, concurrency, approval,
   duplicate-event and stale-authorization tests against emulators.
5. Add Functions entry points and Secret Manager integration, then verify a staging workflow.
6. Add Storage only with attachment intake; add Cloud Run when starting voice.

Cloud Functions is the default backend. The later bidirectional WebSocket voice bridge
uses Cloud Run with explicit connection timeouts, disconnect and reconnection handling.

## Official references
- [Verify Firebase ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Custom claims and propagation](https://firebase.google.com/docs/auth/admin/custom-claims)
- [Firestore rules and server SDK bypass](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Firestore transactions and retries](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firestore event delivery](https://firebase.google.com/docs/functions/firestore-events)
- [Function secrets](https://firebase.google.com/docs/functions/config-env)
- [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)

# Gateway, trust and security contract

## Authority
Model is an untrusted planner, never an authorized caller of arbitrary APIs. Only registered, tenant-scoped operations may execute. Each defines `operation_id`, `domain`, `input/output schemas`, `min_risk`, `roles`, `auth_strength`, `approval_policy`, `timeout`, `idempotency_semantics`, `verification_strategy` and deterministic adapter.

Risk classes inherited conceptually from Robot Core:
- **READ**: scoped lookup without writes.
- **ROUTINE**: small, bounded low-impact write, e.g. create internal technician note.
- **SENSITIVE**: externally consequential CRM changes, schedule modifications, outbound customer communication; exact-action authenticated approval by default.
- **CRITICAL**: billing, destructive changes, account permission changes, large financial effects; owner out-of-band approval; initially disabled unless individually reviewed.

Never let a connector downgrade global risk. Provider-specific operations may escalate risk.

## Authentication and actor binding
- Validate Twilio signatures and account-to-number ownership. Provider webhook authenticity does **not** authenticate the human caller.
- An inbound number is one identity signal, not proof; numbers are spoofable, shared or recycled. Enrollment verifies phone ownership with OTP and creates staff mapping; higher-risk actions require strong step-up via signed, short-lived, device-bound owner/employee confirmation link or logged-in portal.
- Never ask for reusable passwords or API secrets over SMS/voice. Avoid relying on verbal PIN alone for high-risk operations.
- Keep unknown/customer identities separate from employee routes and company private context. New speaker or conflicting evidence invalidates authorization and pending approval.
- Derive `tenant_id`, role and principal from the server's validated channel connection and auth state, never from an LLM-supplied envelope.

## Phase 1 account policy
MFA is excluded by the owner’s decision. Email/password identity and email verification,
password reset, recent password confirmation for sensitive administration, token
revocation and current company authorization remain enforced. The owner controls Vercel
hosting and the final backend deployment.

## Firebase identity and authorization target
Firebase Authentication establishes user identity. Backend functions verify identity and relevant revocation/step-up evidence, then resolve active company membership from Firestore. Mutable technician grants and assignments remain authoritative in Firestore; token claims alone must not preserve revoked permissions. Every Admin SDK operation explicitly enforces tenant/resource policy because Firestore client rules do not protect server SDK access. Start with default-deny browser Firestore/Storage access and route business operations through the Gateway. See [Firebase decision](FIREBASE.md).

## Customer-controlled technician permissions
Company owners choose per-operation technician grants, record scopes and job assignments during enrollment and may edit them later. Missing grant means denied; enrollment never grants owner/admin tools. Validate each requested grant against the registered operation and its supported scopes. `own` note reads show only employee-authored notes on currently assigned jobs, `assigned` limits access to currently assigned jobs, and `all` is restricted to the current tenant. Every resource lookup and list applies tenant plus current scope. Role permission alone never authorizes an arbitrary record ID. Permission edits are owner-authenticated and audited; they cannot lower the global risk floor or skip approval. Deactivation revokes existing sessions.

## Approvals
Persist proposal ID, tenant, actor, operation, normalized argument hash, expiry, risk, target provider and required approval assurance. One approval only applies to that digest. Use one-time signed approval challenges; terminal decisions are immutable and fully audited. Approval and execution must be transactionally coordinated where possible. No approval link accepted for a changed operation. Never hand agent access to approval mutators.

Immediately before execution, revalidate initiating session and active membership, current operation permission, record assignment/scope, normalized proposal digest and provider, approval expiry, and approving principal’s current session, active membership and authority. An approval does not preserve revoked access. Serialize these checks with local policy updates and execution; production remote workers require durable claim/lease and a final authorization check before dispatch. Reject stale work and audit the reason. Cached read results must never bypass current scope.

## Idempotency and correctness
- Inbound SMS/call webhook replay protection and secure event idempotency.
- Durable write intent before external execution. If provider supports native idempotency keys use them. Otherwise use provider resource correlation / lookup and reconciliation; ambiguous timeout MUST NOT blindly retry a potentially executed write.
- Explicit result distinctions: `verified_persisted`, `provider_accepted`, `pending_confirmation`, `rejected`, `failed`. Human-facing confirmation should say "saved in [provider]" only for verified persisted states, or explain the narrower evidence.
- Store provider request/record IDs, source response IDs and safe audit event; do not log credentials, entire transcripts or unneeded PII.

## Secrets, BYO accounts and tenancy
- Customers maintain and pay for their own Twilio, OpenAI and CRM accounts.
- Prefer delegation/OAuth where provider supports it. For OpenAI, issue customer guidance to create project-scoped restricted key with minimum required permissions. Key material is accepted via TLS, encrypted server-side with KMS or equivalent; reveal-once, rotation and disconnect/revoke flow. No admin or organization-wide OpenAI key by default.
- For Twilio account ownership prefer a narrowly scoped credential and configuration instructions; identify which features require broader scopes and obtain explicit consent. Do not ask for the master account token without a justified security review.
- Providers may impose A2P 10DLC registration, use restrictions, phone/media consent, or marketplace/API app approval. Setup wizard must explain prerequisites and show readiness, not assert registration is automatic.
- Use separate encryption context, rate limits, audit partitioning and tenant-aware credential retrieval. Secret manager must check tenant ownership, not simply key ID.

## Observability and outage handling
- Track only calls GhostAI makes with customer OpenAI keys: success, quota/billing/rate-limit errors, latency, tokens and modeled costs. Account-wide usage requires optional separate permissions and explicit provider support.
- No expensive API heartbeat every few seconds; use passive telemetry, occasional low-cost checks and provider status.
- Alert owners and internal support according to severity; don't send unnecessary credentials or PII in alerts.
- If voice AI is unavailable, explain temporary failure, optionally collect voicemail/structured callback request within legal/consent rules; avoid impersonated success. SMS failed deliveries go to queue and alert with dedupe.
- Backup, recovery, incident response, access logging, privacy policy, data deletion/retention rules and production security testing are launch requirements.

## Release-blocking security tests
1. Cross-company phone spoofing, wrong number/account mapping, malicious webhook payloads.
2. Attempted tenant change through prompt injection/tool args, queue messages, cache keys and record IDs.
3. Employee role downgrade/upgrade and unauthorized CRM record access.
4. Stolen approval replay, expiry, changed args, concurrent approval races.
5. Duplicate webhook, double remote write, provider timeout after successful write.
6. Key invalidation/rotation, per-tenant quota outage, webhook secrets leak scans.
7. MMS malware/oversized media; content retention and secure storage controls.
8. Model hallucinated completion and failure-state user messaging.

## Phase 0 implementation limit
The local prototype implements these checks with hashed demo sessions and serialized SQLite transactions. The fake CRM shares the same database transaction. This demonstrates local contract behavior, not strong human authentication or cloud/remote execution safety. See [Prototype guide](PROTOTYPE.md) for production prerequisites.

## Original Robot Core constraints to upgrade
Original Gateway: strong strict operation allowlist/schema/identity/risk contracts; **local** SQLite and partly in-memory request and approval tracking, original principal model without enterprise tenant boundary. GhostAI requires durable multi-worker states, tenant isolation, external audit/reconciliation, step-up for phone/SMS, security reviews and provider-specific policies before commercialization.

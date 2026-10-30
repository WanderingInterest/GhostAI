# Architecture — provider-neutral hosted AI operation layer

## Phase 0 implementation
The primary local app now uses Next.js, Firebase Auth, TypeScript Cloud Functions and Firestore emulators. It has customers, properties, scheduled jobs, service notes, repair requests, permissions and approvals; see [Development guide](DEVELOPMENT.md). The earlier Python HTTP/SQLite workbench is retained as a reference. It exercises native notes and a fake CRM through the Gateway. Firebase is the selected production platform; see [Firebase decision](FIREBASE.md). The deployment design below remains the production target; see [Prototype guide](PROTOTYPE.md) for exact coverage and limits.

## Executive implementation

The TypeScript Agents SDK Executive is implemented in `functions/src/agent`, with a local Assistant conversation screen, explicit tool catalog, business adapter boundary and durable Firestore turns. It uses the existing Gateway rather than a separate authorization path. See [Executive design and future integration points](EXECUTIVE.md). SMS and voice ingress remain future work.

## System map
```mermaid
flowchart TD
  A[Employee phone: call/SMS/MMS] --> B[Customer-owned Twilio]
  B --> C[Public channel ingress / webhook verifier]
  C --> D[Identity and tenant resolver]
  D --> E[Conversation coordinator]
  E --> F[OpenAI Agents SDK / tenant model client]
  F --> G[GhostAI Gateway: authorization + approvals + policies]
  G --> H[Capability/connector registry]
  H --> I[Optional CRM adapters]
  H --> J[GhostAI-native notes/tasks]
  I --> K[Customer CRM: Jobber / Pool Boy / future]
  G --> L[Durable execution & audit]
  L --> M[Receipt / alerts / admin portal]
  M --> B
  N[Owner admin portal] --> D
  N --> G
  O[Secret manager / tenant credentials] --> C
  O --> F
  O --> I
```

## Components and deployment boundaries
1. **Portal**: Next.js, TypeScript, Firebase Authentication with explicitly configured sign-in and step-up methods, company invitations, consent, employee roles, connector setup, approvals, health and audit. Avoid duplicating CRM views.
2. **Channel ingress**: Cloud Functions for Firebase HTTPS Twilio webhooks (validate signatures with correct public URL, raw request/body semantics); use explicit Twilio account/number binding to resolve tenant, reject unknown numbers/accounts, deduplicate provider message SID/call events. Store media privately and validate types/sizes.
3. **Realtime voice service**: Separate Cloud Run service for long-lived WebSocket/media streaming endpoint; bridge Twilio audio to OpenAI Realtime or a well-tested speech pipeline. Session interruption/barge-in, turn detection, latency, reconnect, phone hangup, consent prompts and deterministic failure fallback. One authoritative agent session; no separate competing agents.
4. **Conversation/runtime**: OpenAI Agents SDK orchestration with one primary Executive and capability-scoped tools. The runtime does not choose tenant identity or permissions; those originate in authenticated ingress. Use one customer's restricted OpenAI API key per invocation, never a shared provider client with mutable credentials across tenants.
5. **Trusted Gateway**: Provider-agnostic operation registry, READ/ROUTINE/SENSITIVE/CRITICAL classes, JSON schema validation, tenant-aware access, limited concurrency, approval state, durable idempotency and verified result semantics.
6. **Connector registry**: Adapter manifests express capabilities and schemas; dynamic tool availability = connected provider + supported operation + caller role + current health. CRM stays authoritative for CRM records.
7. **Worker + queue**: Durable handling of outbound SMS, non-realtime work, retries, event processing, reconciliation and approval timeouts; per-tenant quotas and backpressure.
8. **Database + secret storage**: Cloud Firestore for organization/member/channel bindings/conversations/requests/receipts/audit; Cloud Storage for Firebase for optional private attachments; Secret Manager/KMS for tenant provider credentials, never plain secrets in Firestore, logs or model input.
9. **Monitoring**: Customer integration health and actionable notifications; staff-facing status, trace IDs, provider classification and no sensitive payload leakage.

## Request lifecycle
1. Verify provider signature and deduplicate inbound event; bind `tenant_id` via authenticated Twilio account/resource mapping, not AI text and not sender alone.
2. Resolve actor to `principal_id`, `identity_assurance`, role and allowed operations. Unknown: minimal public intake capabilities.
3. Store turn and route to organization's OpenAI project (restricted BYO key).
4. Agent proposes registered tool invocation: `tenant_id`, `principal_id`, `conversation_id`, `request_id`, `operation_id`, validated arguments.
5. Trusted Gateway validates current tenant membership, actor, operation permission, per-record scope/assignment, connector availability, risk class and approval policy; never trusts agent-supplied identity or tenant fields.
6. Persist idempotency key and execution state **before remote call**. For sensitive/critical work, wait for approval on exact normalized operation digest.
7. Immediately before execution, revalidate the initiating session, active membership, current operation and resource permissions, exact proposal digest/provider, approval expiry, and approver’s current session/membership/authority. Permission or assignment revocation rejects queued work. Invoke adapter and record provider IDs/status. Where supported, read back canonical resource and validate intended change.
8. Return `verified_persisted`, `provider_accepted`, `pending_confirmation`, `rejected` or `failed` with safe explanation and specific receipt. Unknown outcome triggers reconciliation, not automatic duplicate write.
9. Send SMS/speak result; preserve audit and health telemetry.

## Multi-tenant data design
Core records: `organizations`, `users`, `memberships`, `phone_identities`, `channel_connections`, `provider_connections`, `credentials_refs`, `conversations`, `messages`, `operation_definitions`, `operation_requests`, `approvals`, `provider_receipts`, `audit_events`, `usage_events`, `alerts`, `attachments`.
Owners configure individual technician operation grants and `own`/`assigned`/`all` resource scopes during enrollment and can edit them afterward. `own` note reads include only employee-authored notes on currently assigned jobs; `assigned` limits an operation to assigned jobs; `all` covers only the current company. Missing grants deny access. Gateway checks each resource ID against both tenant and current scope before adapter invocation; list/search operations filter before returning records. Neither model arguments nor owner enrollment settings can lower global risk or approval requirements. Cached reads are reevaluated under current scope to prevent stale permission leaks.

Every tenant-owned document uses `tenant_id` under `organizations/{tenantId}/...`; enforce server-side authorization and matching document paths. Start with browser access through authenticated backend functions and default-deny Firestore/Storage client rules. Admin SDK calls bypass Firestore rules, so every backend operation must enforce Gateway authorization. Apply strict authorization in worker queues, caches and object storage. Do not trust user-supplied tenant IDs. Unique keys include tenant + provider + webhook event ID, and tenant + idempotency key. Retain minimal message content with configurable retention and deletion/export paths.

## Technology proposal and tradeoffs
- **API / portal**: Next.js (Vercel optional). Long-lived Twilio Media Streams MUST use a WebSocket-capable service; ordinary stateless serverless API routes are not sufficient for live bidirectional media.
- **Agent Gateway / runtime**: TypeScript Cloud Functions with the OpenAI Agents SDK. The Gateway preserves the original Robot Core contract behavior with critical authorization, approval and idempotency checks; the earlier Python implementation remains a reference.
- **Persistence**: Cloud Firestore transactions and tenant-scoped documents, optional Cloud Storage, Secret Manager/KMS. Avoid local SQLite and process-local approval caches in a horizontally scaled service.
- **Operations**: Cloud Functions handlers plus durable jobs with Firestore execution leases/outbox and dead-letter handling; no external side effects inside retryable Firestore transaction callbacks; provider retries only where idempotency is proven.
- **Deployment**: separate dev/staging/prod, health probes, tenant-scoped metrics, backups, runbooks and key rotation.

## Source-reference note
Adapt `WanderingInterest/robot-core/robot_core_gateway/` and `docs/migration/AGENT_GATEWAY_CONTRACT.md`; do not import robotics/hardware domains or copy desktop SQLite assumptions. `robot-core-personal` has separately useful Realtime/context patterns but a distinct custom inference runtime. No claim is made that GhostAI currently runs either source.

# GhostAI — Implementation Plan
Date: 2026-10-29

## Goal
Deliver a phone-and-SMS-first AI business assistant for small service teams. The company owns its Twilio number, OpenAI API project and optional CRM accounts. GhostAI hosts the intelligence layer and verified operations. Administrative web interface stays lightweight.

## Phase 0 — Foundation (local functional prototype implemented)
Implementation: [Prototype guide](PROTOTYPE.md). Python service + browser workbench, tenant/resource authorization, owner-configurable technician permissions at enrollment and afterward, hashed demo sessions, native notes, fake CRM, exact-action approvals with current authorization rechecks, durable SQLite requests/receipts/audit, schema and CI tests. This local storage and demo authentication are explicitly replaced/hardened in Phase 1. No live AI or provider connection is included.

- Create workspace, CI, local development environment, schema and connector contracts.
- Adapt the original Robot Core Gateway's registered-operation model and tests.
- Define tenant organization, employee, conversation and approval models; one shared result vocabulary from `ghostai/contracts.py`.
- Exit: Fake connector is only accessible through tenant-scoped Gateway.

## Firebase foundation update
Implemented Next.js portal and TypeScript Firebase Functions, with Firebase Auth, Firestore transactions, basic demo CRM, invitation acceptance and editable technician permissions. Core emulator tests pass. This ports the Gateway behavior rather than deploying the Python service. Live setup: project `ghostai-794c5`, `(default)` database in `nam5`, Functions `us-central1`. Backend deployment is reserved for the owner. MFA is excluded by request; quotas and production hardening remain pilot work. See [Development guide](DEVELOPMENT.md).

## Phase 1 — Trust, accounts and native actions
Implemented: Firebase email/password verification and reset; invitations and technician access; recent password confirmation; all-device session revocation; native Firestore notes and demo job records; owner OpenAI credential validation, encrypted storage, replacement/check/disconnect; backend deployment script. Vercel hosting will be handled separately by the owner. MFA is excluded. Final live enrollment/isolation verification follows the owner-run deployment; local critical checks establish contract behavior only.

- Replace local demo bootstrap/session switching with Firebase Authentication, company accounts, strong owner login, invitations and session recovery. Preserve configurable technician operation grants/scopes/assignments at enrollment and afterward.
- Encrypted storage of per-company OpenAI project credentials.
- Migrate prototype SQLite persistence to Cloud Firestore with tenant-scoped documents, transactional idempotency/approvals and explicit backend authorization. Add default-deny client rules and Emulator Suite tests; preserve the Gateway contracts.
- Implement HTTP/webhook and bounded worker entry points with Cloud Functions for Firebase. Add Cloud Storage for Firebase only when private attachments are implemented. See [Firebase decision](FIREBASE.md).
- Implement native business notes/tasks for operation without a CRM.
- Exit: Two distinct companies cannot see each other's data or execute each other's operations.

## Executive runtime — implemented locally before SMS

One Agents SDK Executive now connects a local web conversation to registered demo CRM/native note tools through the existing Firebase Gateway. Durable actor-scoped turns, bounded model/tool calls, idempotent native actions, receipts, current authorization and owner approvals are implemented. Owners can create/edit/search customers, properties and jobs, edit notes and repairs, resolve repairs, and archive/restore CRM records. Technician grants remain enforced. This is the missing explicit runtime milestone required by Phase 2. The owner must redeploy for live use. See [Executive design](EXECUTIVE.md). SMS/voice transports and external CRM adapters remain pending.

## Phase 2 — SMS

Public privacy/terms/support pages and the technician self-service consent form are implemented locally. Versioned consent and withdrawal events are saved by the authenticated backend. Phone verification, Twilio webhooks, STOP/HELP and outbound delivery remain pending; consent alone does not enable SMS. See [Twilio setup](TWILIO_SETUP.md).
- Guided customer-owned Twilio connection and webhook routing.
- Signature checks, message replay detection, outbound delivery receipts, consent/STOP handling.
- Verified phone enrollment with owner-selected technician grants/scopes/assignments and strong step-up confirmation for sensitive writes; revalidate current authorization at execution.
- Exit: Text from an enrolled handset produces a verified native task and SMS receipt; duplicate webhook does not duplicate operation.

## Phase 3 — Voice
- Persistent media-stream service connecting Twilio call audio to OpenAI voice assistant.
- Shared conversation policy and Gateway operations across voice/SMS.
- Handle interrupt, hangup, latency, account outage and audio session failure.
- Exit: Live call performs and verifies a bounded native operation, with truthful failure handling.

## Phase 4 — Optional business integration
- Connector registry and provider conformance tests.
- Implement a first external CRM adapter chosen by accessible API and pilot customer demand.
- Jobber is optional, not a launch dependency; consider Pool Boy as initial validation path.
- Exit: At least one supported external write returns a verifiable CRM record receipt; ambiguous outcomes are reconciled rather than blindly retried.

## Phase 5 — Admin, reliability and pilot
- Connection health, OpenAI account failures, provider errors, audit receipts, approvals and alerts.
- Secure image/media intake if MMS is ready; otherwise mark pending.
- Perform concurrency, isolation, credential rotation, retention, webhook spoofing and failover tests.
- Pilot with 1–3 customer-owned account setups; measure onboarding effort and time saved.
- Exit: Repeatable onboarding, explicit remediation for outages, no silent write failures.

## Prototype pacing
A two-week internal proof of concept is a possible engineering target, based on prior Robot Core experience. Commercial release requires additional security tests, telecom compliance and provider approvals. Keep milestones evidence-based rather than guaranteeing dates.

## Planned production folders
- apps/admin-web — Next.js admin setup and exception review
- services/api — REST/webhook ingress
- services/agent — OpenAI Agents SDK runtime
- services/voice — real-time voice streaming
- packages/gateway — authorization and operation contracts
- packages/connectors — provider-neutral and provider-specific adapters
- infra — Firebase project configuration, Firestore indexes/rules, optional Storage rules, jobs, secrets and deploy
- tests — tenancy, contract, webhook and end-to-end tests

## Release blockers
- Cross-tenant access possible
- Phone number alone authorizes sensitive operations
- Duplicate messages create duplicate CRM changes
- Unverified actions reported as success
- Keys or private data exposed in audit/model logs
- Missing telecom registration/consent
- No fallback for provider billing/key outage

## Early decisions
1. Preserve original Python Gateway behavior with durable cloud implementation rather than copy process-local state.
2. Keep CRM capability manifests explicit and provider APIs separately verified.
3. Prefer customer-owned Twilio, customer-owned OpenAI, and customer-owned optional SaaS integrations.
4. Make the first employee SMS workflow polished before adding wider dashboards or specialized agents.
5. Validate branding separately; repository naming is not trademark clearance.

6. Firebase Authentication, Cloud Firestore, optional Cloud Storage for Firebase and Cloud Functions for Firebase are the selected production stack. Later voice streaming runs in a separate Cloud Run service.

# GhostAI — Implementation Plan
Date: 2026-10-29

## Goal
Deliver a phone-and-SMS-first AI business assistant for small service teams. The company owns its Twilio number, OpenAI API project and optional CRM accounts. GhostAI hosts the intelligence layer and verified operations. Administrative web interface stays lightweight.

## Phase 0 — Foundation
- Create workspace, CI, local development environment, schema and connector contracts.
- Adapt the original Robot Core Gateway's registered-operation model and tests.
- Define tenant organization, employee, conversation and approval models.
- Exit: Fake connector is only accessible through tenant-scoped Gateway.

## Phase 1 — Trust, accounts and native actions
- Company account creation, employee roles, strong owner login and authorization.
- Encrypted storage of per-company OpenAI project credentials.
- PostgreSQL-backed audit and idempotency; per-tenant tool registry.
- Implement native business notes/tasks for operation without a CRM.
- Exit: Two distinct companies cannot see each other's data or execute each other's operations.

## Phase 2 — SMS
- Guided customer-owned Twilio connection and webhook routing.
- Signature checks, message replay detection, outbound delivery receipts, consent/STOP handling.
- Employee enrollment and step-up confirmation for sensitive writes.
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

## Planned folders
- apps/admin-web — Next.js admin setup and exception review
- services/api — REST/webhook ingress
- services/agent — OpenAI Agents SDK runtime
- services/voice — real-time voice streaming
- packages/gateway — authorization and operation contracts
- packages/connectors — provider-neutral and provider-specific adapters
- infra — PostgreSQL, jobs, secrets and deploy
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

# GhostAI
**An AI business assistant employees can call or text.** By Wandering Interest.

GhostAI is a hosted, multi-tenant intelligence and integration layer for small service businesses. A company brings its own communications provider, OpenAI API project, and optional business software accounts. Workers interact through normal calls and SMS/MMS; GhostAI executes bounded, authorized actions and reports verified results. The admin portal is for onboarding, permissions, connections, health and exceptions—not a replacement CRM.

**Status:** Architecture and project planning only. No application code or integrations are implemented in this repository yet.

## Core principles
1. **Conversation, not another app:** Phone/SMS first; administrative web UI second.
2. **Customer-owned accounts:** Twilio account/number, OpenAI project/key and CRM credentials remain customer-controlled; customers pay providers directly.
3. **CRM-neutral:** Jobber and Pool Boy are optional connectors. GhostAI works in a useful, limited mode without a CRM.
4. **Gateway-controlled execution:** AI never calls providers directly. All operations require a registered contract, tenant context, role authorization and risk policy.
5. **Verified results:** Never tell an employee a CRM update succeeded on model output alone; distinguish provider acknowledgement from persisted read-back.
6. **Tenant isolation:** Company-specific data, keys, calls, staff, events and AI budgets must never mix.
7. **Fail safely:** Invalid identity, revoked keys, outages or unverified writes degrade honestly and alert the owner.

## Documents
- [Product scope and experience](docs/PRODUCT.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Gateway, identity and security](docs/SECURITY_GATEWAY.md)
- [Connector and communication contracts](docs/INTEGRATIONS.md)
- [Project execution plan](docs/PROJECT_PLAN.md)

## Initial technology direction
- Next.js / TypeScript / Tailwind for small administration portal.
- Python service for OpenAI Agents SDK and adaptation of Robot Core's Python gateway; split voice streaming and background work into dedicated long-lived services.
- PostgreSQL for tenant configuration, conversations, execution/audit records and durable idempotency.
- Managed secrets/KMS, per-tenant envelope encryption, a durable queue/worker, observability.
- Twilio adapter for SMS/MMS webhooks and call media streams. Other providers can follow.
- Bring-your-own-OpenAI-key with project-scoped restricted keys, customer billing and per-tenant health checks.

## Robot Core provenance
This product should **adapt**, not copy blindly, the original `WanderingInterest/robot-core` gateway model: `docs/migration/AGENT_GATEWAY_CONTRACT.md`, `docs/migration/GATEWAY_FIRST_PASS.md`, and `robot_core_gateway/`. The original implementation was local-owner-oriented, with SQLite and in-memory deduplication/approvals; those are NOT sufficient as-is for GhostAI's cloud multi-tenant environment. The `robot-core-personal` application also has useful conversation and voice patterns but uses a different custom runtime. See the security document for required changes.

No assumptions about Jobber or other third-party write capabilities should be treated as verified until tested against the provider's current API and approval policy.

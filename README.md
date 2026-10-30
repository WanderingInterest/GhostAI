# GhostAI

**An AI business assistant employees can call or text.** By Wandering Interest.

GhostAI is a hosted, multi-tenant intelligence and integration layer for small service businesses. A company brings its own communications provider, OpenAI API project, and optional business software accounts. Workers interact through normal calls and SMS/MMS; GhostAI executes bounded, authorized actions and reports verified results. The admin portal is for onboarding, permissions, connections, health and exceptions—not a replacement CRM.

**Status:** Phase 1 account/CRM backend deployed by the owner; the new Executive runtime is available locally and awaits owner deployment. MFA is excluded as requested; frontend hosting is Vercel. Includes Firebase email/password sign-in and verification, owner-issued invitations, editable technician permissions, a basic demo CRM (customers, properties, scheduled jobs, notes and repair requests), exact-action approvals and Firestore receipts. The OpenAI Agents SDK Executive is available locally through the Assistant screen. SMS, voice and external CRM integrations are not connected.

## Run the local AI assistant

```sh
npm run setup:assistant -- /absolute/path/to/key-file.txt
npm run demo:assistant
```

Open http://127.0.0.1:3000/?view=assistant and choose **Open demo workspace**. Local CRM records are synthetic; AI requests use your OpenAI account. See [Executive runtime and integration boundaries](docs/EXECUTIVE.md).

## Deploy the backend

```sh
npm run deploy:backend
```

Run this yourself when ready. It preserves/creates the managed vault key and deploys only Functions plus Firestore rules/indexes to `ghostai-794c5`. No frontend is deployed. Afterward, stop the local preview and run `npm run dev:live` to use real Firebase. See [Deployment and Vercel setup](docs/DEVELOPMENT.md).

## Run the app

Requires Node 24.12+ and Java 21.

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

Open http://127.0.0.1:3000 and choose **Open demo workspace**. Local mode uses `demo-ghostai`; live mode is configured for `ghostai-794c5`. See [Development and Firebase setup](docs/DEVELOPMENT.md) for deployment requirements and critical checks.

The earlier Python prototype remains available with `python3 -m ghostai.server` on port 8765 as a reference implementation.

## Core principles

1. **Conversation, not another app:** Phone/SMS first; administrative web UI second.
2. **Customer-owned accounts:** Twilio account/number, OpenAI project/key and CRM credentials remain customer-controlled; customers pay providers directly.
3. **CRM-neutral:** Jobber and Pool Boy are optional connectors. GhostAI works in a useful, limited mode without a CRM.
4. **Gateway-controlled execution:** AI never calls providers directly. All operations require a registered contract, tenant context, role authorization and risk policy.
5. **Verified results:** Never tell an employee a CRM update succeeded on model output alone; distinguish provider acknowledgement from persisted read-back.
6. **Tenant isolation:** Company-specific data, keys, calls, staff, events and AI budgets must never mix.
7. **Fail safely:** Invalid identity, revoked keys, outages or unverified writes degrade honestly and alert the owner.

## Documents

- [Next.js / Firebase development and deployment](docs/DEVELOPMENT.md)
- [Legacy Phase 0 Python prototype](docs/PROTOTYPE.md)
- [Product scope and experience](docs/PRODUCT.md)
- [Executive runtime and integration boundaries](docs/EXECUTIVE.md)
- [Public policies, consent and Twilio verification](docs/TWILIO_SETUP.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Firebase architecture decision](docs/FIREBASE.md)
- [Gateway, identity and security](docs/SECURITY_GATEWAY.md)
- [Connector and communication contracts](docs/INTEGRATIONS.md)
- [Project execution plan](docs/PROJECT_PLAN.md)

## Production technology direction

- Next.js / TypeScript / custom responsive CSS for small administration portal.
- Cloud Functions for Firebase for the HTTP/webhook backend, Gateway and bounded background work; preserve the original Gateway security contracts. Use a separate Cloud Run service for later voice streaming.
- Firebase Authentication for user identity; Cloud Firestore for tenant configuration, conversations, permissions, approvals, audit and durable idempotency.
- Cloud Storage for Firebase for optional private attachments; Google Cloud Secret Manager/KMS for provider credentials, plus durable jobs and observability.
- Twilio adapter for SMS/MMS webhooks and call media streams. Other providers can follow.
- Bring-your-own-OpenAI-key with project-scoped restricted keys, customer billing and per-tenant health checks.

## Robot Core provenance

This product should **adapt**, not copy blindly, the original `WanderingInterest/robot-core` gateway model: `docs/migration/AGENT_GATEWAY_CONTRACT.md`, `docs/migration/GATEWAY_FIRST_PASS.md`, and `robot_core_gateway/`. The original implementation was local-owner-oriented, with SQLite and in-memory deduplication/approvals; those are NOT sufficient as-is for GhostAI's cloud multi-tenant environment. The `robot-core-personal` application also has useful conversation and voice patterns but uses a different custom runtime. See the security document for required changes.

No assumptions about Jobber or other third-party write capabilities should be treated as verified until tested against the provider's current API and approval policy.

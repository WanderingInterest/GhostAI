# Phase 0 functional prototype

## Run locally
Requires Python 3.11+; no runtime dependencies or API keys.

```sh
python3 -m ghostai.server
```
Open http://127.0.0.1:8765. Run from the repository root. Optional arguments:
`--port 8766 --db /tmp/ghostai-demo.sqlite3`.

1. Create a local company. Two sample jobs are created automatically.
2. Enroll a technician. Pick individual operation permissions and scopes, and assign jobs.
3. Use Saved demo identities to switch to the technician (or copy the once-displayed access code to another browser).
4. Select `business_note.create`, choose an assigned job, enter a note, and run it. A persisted receipt confirms the native record.
5. Submit it again with the same key: one record, same receipt. Use New request key for a different operation or different arguments.
6. Grant `service_request.create` to try a simulated CRM write. Submit as the technician, switch to owner, and approve in the inbox. The receipt explicitly identifies the fake provider.
7. Edit the technician’s access before approving another request. Removing permission, removing the job assignment, or deactivating the employee prevents execution.
8. Create a second company to explore isolation. The API rejects foreign job IDs and approval IDs even if submitted manually.

Permissions may be configured during enrollment and edited afterward. Off means denied.
`assigned` means only assigned jobs; `all` means any job **in the same company**.
`own` is available for reading notes and restricts results to the employee’s own notes
on currently assigned jobs. Owner access covers their company. Global risk and approval
requirements cannot be lowered by an enrollment permission.
Deactivation revokes access codes permanently. Reactivation alone does not restore a
revoked code; for this prototype, enroll a new test identity to regain access. Session
recovery and managed invitations belong to Phase 1.

## Implemented boundaries
- Provider-neutral operation registry: strict input fields/types/limits, immutable risk, scope, provider, local execution deadline, verification and idempotency semantics.
- Trusted context from a hashed bearer session; tenant/principal/role fields in operation payloads are rejected.
- Tenant-scoped jobs, assignments, conversations, native notes, fake CRM requests, approvals, receipts, and audit records.
- Resource authorization before reads/writes and cached receipt access; read replays are reevaluated under current permissions.
- Ten-minute exact-action owner approvals; one final decision. Execution rechecks initiator session, active membership, operation permission, job assignment, approver session/role, expiry, digest and provider.
- Tenant-key idempotency with immutable proposal digest. Concurrent duplicates cannot create duplicate local writes.
- Durable local SQLite transactions, foreign keys and write serialization. Approval execution, simulated side effect, read-back and receipt commit atomically. Adapter failures roll back to a savepoint and return safe errors.
- Persisted conversations and sanitized audit events; no full transcripts or API credentials.
- Loopback-only HTTP service, same-origin/Host checks, bounded JSON input, CSP, and a browser UI.

The authoritative result vocabulary is defined in `ghostai/contracts.py`:
`verified_persisted`, `provider_accepted`, `pending_confirmation`, `rejected`, `failed`.
`provider_accepted` is reserved for future connectors that cannot yet prove persistence.
The UI always labels fake CRM results as simulated.

## Local API
All endpoints except company creation, health and static assets require
`Authorization: Bearer <access_code>`. POST uses `Content-Type: application/json`.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/companies` | Local bootstrap: `{ "name": "Demo company" }`; returns owner access code |
| `GET /api/state` | Current company, actor, authorized jobs, permission catalog and receipts; owner gets team, approvals and audit |
| `POST /api/staff` | Owner enrollment: `name`, `permissions`, `job_ids`, `active`; returns a technician code once |
| `POST /api/staff/{id}` | Owner edits the same fields; role cannot be escalated through this endpoint |
| `POST /api/operations` | `operation_id`, `arguments`, `idempotency_key`, `conversation_id` |
| `POST /api/requests/{id}/approve` | Owner-only `{ "approve": true }` or false |
| `POST /api/requests/{id}/execute` | `{}`; actor or owner executes an approved request with fresh checks |
| `GET /api/health` | Database readiness and advertised local providers |

No direct connector or arbitrary tool execution endpoint exists. Python module internals
are not a sandbox against someone who already controls the host process.

## Verification
```sh
python3 -m unittest discover -s tests -v
python3 -m compileall -q ghostai tests
node --check web/app.js
```
Node is only needed for the JavaScript syntax check. CI runs the same checks.
The tests cover native read-back, strict schema rejection, unregistered operations,
permission editing, unauthorized enrollment, assignment and tenant isolation, cached
read scope reduction, exact proposal binding, duplicate concurrency, persistence across
restart, approval expiry/replay/revocation, role/session rechecks, adapter rollback,
local deadline failure, audit privacy, and real HTTP workflows.

## Deliberate Phase 0 choices and limits
This is a **source-checkout, local-only simulation**, not a production service. Browser
identity switching stores demo bearer codes in localStorage; the current code is also
in sessionStorage. Codes expire in 24 hours. There is no real identity proof, hosted
login, phone enrollment, session recovery or rate-limited public signup. Use synthetic
data and do not expose the server through a tunnel or reverse proxy.

SQLite is used **only for this local prototype**; Cloud Firestore is the selected production persistence layer. Approval
and fake provider writes share one transaction, so distributed reconciliation and
remote ambiguous outcomes are not demonstrated. The deadline is checked after a
bounded local handler returns; it is not a cancellation mechanism for remote I/O.
Production requires the Firebase migration described in [Firebase decision](FIREBASE.md):
Firestore transactions/rules, durable workers/outbox/leases, provider-specific timeouts,
reconciliation, Firebase Authentication/step-up and Secret Manager/KMS.

No OpenAI SDK, autonomous agent, live CRM, Twilio, SMS, voice, MMS, provider billing,
or encrypted customer credential intake is implemented. The structured workbench
lets a human propose operations through the future agent boundary without provider
costs. The deployment folders in the project plan remain the later service split;
Phase 0 keeps one auditable Python service and a dependency-free browser UI.

## Robot Core adaptation
Reviewed `WanderingInterest/robot-core/docs/migration/AGENT_GATEWAY_CONTRACT.md`.
Preserved the conceptual allowlist, deterministic adapter boundary, strict inputs,
identity/authorization separation, risk floor and exact-action approvals. No Robot
Core source code or hardware domains were copied. GhostAI adds explicit tenant and
resource scope, current authorization rechecks, durable requests and its own shared
result vocabulary. This prototype does not claim full Robot Core runtime conformance.

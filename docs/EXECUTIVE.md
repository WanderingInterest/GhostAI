# GhostAI Executive

The Executive is one OpenAI Agents SDK agent running inside the TypeScript backend.
The web Assistant is its first channel. It operates on the demo CRM and native notes
through the same Gateway used by the portal. SMS, voice and external CRM adapters
are later integration work, not required to use the local assistant.

## Local use

Requires Node 24.12+ and Java 21. Configure a development key from a private file:

```sh
npm run setup:assistant -- /absolute/path/to/key-file.txt
npm run demo:assistant
```

The launch command starts local Auth/Firestore/Functions, seeds synthetic records,
then starts Next.js in emulator mode. Stop existing services on ports 3000, 5001,
8080 and 9099 first. Open http://127.0.0.1:3000/?view=assistant, choose **Open demo
workspace**, then **Assistant**. The demo owner and technician use the accounts
printed by the seed command; real Firebase accounts are separate.

The setup command stores the key in owner-readable `functions/.env.local`, excluded
from Git and the Functions upload. It is only resolved for `demo-ghostai` under the
Functions emulator, for the seeded `demo-owner` company. It is never stored in
emulator Firestore. Local CRM data is synthetic; model requests still go to OpenAI
and use the key owner's paid API account. Do not use real customer records in the
shared demo. Stopping emulators without exporting their data discards demo edits.

If emulators are already running, use `npm run seed` and `npm run dev:emulator`
instead. Rebuild Functions after backend changes; the Functions emulator reloads
compiled files. Restart the emulator if it has not picked up an environment change.

Example requests:

- Create a customer named Taylor Green; email and phone are unknown.
- Add a property for Taylor at 500 Service Road, then schedule a pool inspection on November 5, 2026.
- Change Taylor’s contact number to 602-555-0123.
- Find Johnson's jobs.
- Add a note to Johnson's pool service: cleaned baskets and checked chemistry.
- Mark that job completed.
- Request a repair for the leaking return valve.

Repair requests remain pending until an owner approves them in the existing inbox.
Receipts update when the conversation is loaded again. Job updates and repairs are
explicitly demo CRM operations; native notes are saved in GhostAI. No external CRM
or outbound customer communication is available.

## Implementation boundaries

| Component | Responsibility |
| --- | --- |
| `functions/src/agent/model.ts` | Agents SDK agent/runner, per-invocation OpenAI client, tool schema translation, bounded loop |
| `functions/src/agent/runtime.ts` | Authenticated actor/company context, durable turns, leases, idempotency, limits, safe failure handling |
| `functions/src/agent/tools.ts` | Registered schemas, permission/risk metadata, business adapter interface and current demo adapter |
| `functions/src/service.ts` | Authoritative current permissions, resource scope, approvals, atomic writes and receipts |
| `functions/src/crm.ts` | Owner CRM catalog, paged lookups, atomic create/edit/archive/restore with receipts and record revisions |
| `functions/src/credentials.ts` | Tenant-bound decryption for trusted runtime; no browser key retrieval |
| `apps/admin-web/src/components/assistant.tsx` | Conversation UI and authoritative action receipts |

Public backend routes require verified Firebase bearer identity:

- `GET /orgs/{tenant}/assistant`: connection readiness and currently available tools.
- `GET /orgs/{tenant}/assistant/{conversationId}`: this actor's latest 12 turns.
- `POST /orgs/{tenant}/assistant`: `{conversationId, turnId, message}` only.

Company IDs remain untrusted selectors until membership is checked. Turn IDs are
client-generated idempotency identifiers, not identity evidence. Conversation paths
hash the authenticated actor and conversation ID below the company. Owners cannot
use this API to read another member's private conversations. Each turn's policy
stamp includes membership version, role, grants and assignments. Changed access
hides stale history and blocks further tools from an in-flight run.

Only filtered business records go to the model. Team lists, invitations, credentials,
authentication tokens and approval mutators are not tools. Current registered tools:
`jobs_search`, `job_get`, `notes_list`, `note_add`, `job_status_set`, `repair_request`,
and `actions_recent` for current saved-action and approval outcomes.
Owners additionally have `crm_search`, `crm_get`, `customer_create`, `customer_update`,
`property_create`, `property_update`, `job_create`, `job_edit`, `note_update`,
`repair_update`, `repair_resolve`, and `record_archive`. This covers creation, lookup,
editing and reversible removal/restoration for the demo CRM. Technicians retain
only their granted job/note/repair-request operations; owner tools are both hidden
and rejected server-side for them. Account permissions and approval decisions remain
outside the model tool surface.

Customer creation requires only a name. Optional contacts use null in the tool
schema and become blank CRM fields. Property creation returns its ID for linked job
creation; receipts include record IDs and tool results include current record
metadata. Structured, explicit schemas reject extra model-supplied identity, company
or permission fields.

CRM edits use expected revisions to reject stale overwrites. Portal edits, status
changes and repair resolution also increment these revisions. Pending repair approvals
bind the job revision and are invalidated by job changes or archiving. CRM writes,
receipts and audit events commit in one transaction. A repeated execution key never
reapplies an old mutation.

Creation checks normalized matching records, including archived records, before
inserting. Explicit duplicate creation is supported when the user requests it. The
current duplicate scan is capped at 1,000 records per collection and fails clearly
above that boundary; migrate to indexed identities before a larger pilot. A tenant
collection guard serializes the agent's duplicate checks with portal creations.
Owner search pages scan 50 records and return a continuation cursor, including when
a page has no matching results.

Removal archives records and keeps their receipts. Active children block archiving
a customer/property; there is no implicit cascade. Archiving a job hides its notes
and repairs in active portal views and blocks further job actions. Restoring parents
before children preserves relationships. Notes and repairs can be archived/restored
individually. This is reversible removal, not permanent data erasure.

Each tool rechecks Firebase account validity/revocation, active membership and the
run's policy stamp. The business adapter rechecks record scope through the Gateway.
Write idempotency keys derive from conversation, turn, tool and normalized arguments.
Receipt IDs are recorded before dispatch, so an interrupted generation can still
display a committed action. Native writes and receipts commit together. No model or
provider calls happen inside Firestore transactions.

## Conversation and failure behavior

Each actor can have one active run per company. A durable 120-second lease prevents
overlap across workers; actual runs abort after 50 seconds and tools check that
deadline. Duplicate POSTs return the existing turn without re-running inference.
Failed or abandoned turns are never automatically replayed. The browser preserves
the pending turn ID in session storage; **Check message** reuses that same ID.
If the process dies, history marks an old running turn as interrupted and recovers
any authoritative receipts. An absent receipt does not prove that a remote provider
did nothing; future external adapters must reconcile uncertain effects.

Only the last five completed user/reply pairs are included in model context.
History is converted with the SDK’s `user()` and `assistant()` helpers before each run. Assistant messages require typed content; passing raw role/content string objects causes follow-up turns to fail before reaching OpenAI. A regression check now exercises the real SDK serialization with a local transport.

Raw tool outputs, provider response state and reasoning are not persisted as model
history. Tool lookups must refresh business facts before an action. Recent receipt
cards are resolved from current Gateway records when a conversation is loaded.

Starting limits are 2,000 input characters, 12 model turns, 16 tool calls, six
write invocations, 1,400 output tokens per model request, 20 new messages per minute
and 200 per UTC day per company. These are application bounds, not a guarantee of
an account-wide spending cap. Successful runs record aggregate input/output tokens
and model request counts; interrupted runs may have incurred unrecorded model usage.
Tracing is disabled, Responses storage is disabled, and SDK HTTP retries are disabled.
OpenAI's applicable API data handling still applies. No raw provider exceptions or
keys are returned to clients or written to application audit logs.

`GHOSTAI_AGENT_MODEL` is a backend environment setting; default `gpt-5.4-mini`.
The key needs access to that model and Responses generation. Existing connection
validation only checks models-list access, so a saved key can still fail inference
because of billing, model access or restricted endpoint permissions.

## Expansion points

1. **Business capabilities:** add a strict schema, permission and risk class to the
   registry, implement the capability in the Gateway/adapter, and add critical
   authorization/idempotency coverage. Do not make arbitrary URLs, database paths
   or provider SDK calls into model tools.
2. **External data:** replace or compose `BusinessTools` adapters using an explicit
   tenant connection/capability resolver. Tool availability must intersect current
   grants, connected provider, supported capability and connection health. The
   current implementation has a fixed available demo adapter; it does not claim to
   connect Pool Boy, Jobber, calendars or MCP servers.
3. **Remote writes:** persist intent, use provider idempotency or correlation IDs,
   claim/fence durable work, reconcile uncertain outcomes, then produce receipts.
   Never place a remote side effect in a retryable transaction. Preserve the existing
   owner approval boundary rather than adding model-accessible approval tools.
4. **SMS:** a channel adapter must verify Twilio signature/account/destination,
   deduplicate MessageSid, resolve the enrolled user and assurance, enforce consent
   and STOP, then invoke the same Executive. Extend trusted channel context and
   conversation namespacing explicitly; do not forge Firebase sessions from phone
   numbers or pass model-selected tenant/user fields. Outbound replies use a durable
   outbox and delivery tracking.
5. **Voice:** a separate Cloud Run media bridge owns the audio session and delegates
   business actions to the same trusted registry/Gateway. Keep one authoritative
   conversation owner and preserve interruption and approval semantics.

Before wider production rollout: implement retention/deletion for conversation text,
cursor pagination beyond the current 500-record demo snapshot bound, tenant-configured
budgets, operational alerts and external-provider reconciliation where applicable.
The current synchronous runtime fits bounded web/SMS work; longer work needs durable
queued execution rather than extending HTTP timeouts indefinitely.

## Deployment

The owner previously deployed the account/CRM backend. This Executive change still
requires the owner to run `npm run deploy:backend` for live use. The local demo needs
no cloud deployment. Live calls use each company's encrypted saved key, never the
local development fallback. Frontend Vercel hosting remains owner-managed.

## References

- [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk)
- [Agent definitions and local context](https://developers.openai.com/api/docs/guides/agents/define-agents)
- [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)

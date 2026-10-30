# Product brief and first-release scope
**Product:** GhostAI (Wandering Interest)  
**Audience:** Owners and small teams (approximately 1–5 employees) in pool care, landscaping, cleaning and similar service trades.

## Promise
"Text or call your business assistant. It handles the busywork in the systems you already use." The job is to reduce data entry and administration—not require a second UI or ask workers to double-check every routine update.

## Main interaction
- A worker texts: "Finished Johnson's yard; two heads replaced. Found a leaking valve. Create a repair request."
- GhostAI resolves employee, company and *the exact* property; it asks when ambiguous.
- The Gateway authorizes a declared operation using the worker's permissions.
- A connected CRM adapter creates the request if supported, then confirms provider result and optionally reads the record back.
- GhostAI texts a structured receipt with verified status and a deep link when available; failed/uncertain steps are clearly stated.
- If no CRM is connected, GhostAI can capture a structured internal note/task in its own records, but must never imply a CRM update.

## V1 usable experiences
1. Employee SMS two-way conversation, with company-owned Twilio number; receive/deliver webhooks safely.
2. Inbound phone call to AI, using live speech and the **same Gateway tools** as SMS.
3. Staff enrollment with owner-configurable operation permissions and own/assigned/company-wide record scopes, editable after enrollment; phone verification and stronger owner authentication. Owners cannot lower global risk or approval requirements.
4. Business profile/FAQ, basic internal request and task logging, simple lookups even without CRM.
5. Optional first CRM connector with limited, *verified* read and write operations (choose pilot integration according to access and demand; do not hard-code Jobber).
6. Owner-facing setup, approval inbox, receipts/audit timeline, connection health and usage visibility.
7. MMS image intake with secure attachment storage; CRM photo attachment is feature-gated per connector.
8. Bring-your-own OpenAI API project and secret; per-tenant usage/error telemetry, provider account billing outside GhostAI.
9. Safe customer messaging: draft for approval unless owner explicitly enables a narrowly defined authorized workflow.
10. Graceful unavailable behavior: no invented confirmations; queued safe follow-up or clear fallback notice.

## What V1 does not pretend to do
- Replace Jobber or another CRM; manage payments/payroll; guarantee scheduling mutations; act as an autonomous receptionist for all customer scenarios; expose every integration; use arbitrary plugins without review.
- Promise broad account monitoring from an ordinary inference key; GhostAI can observe its own requests and errors. Organization-wide billing requires separate authorized access and may be deferred.
- Guarantee phone-number identity. SMS sender/Caller ID is a routing signal, not high-trust authentication.

## Default personnel
Owner/admin: onboarding, team, policy, connections, approvals, cost review.  
Crew lead: assigned jobs, routine requests and limited updates.  
Technician: own schedule, service notes and bounded requests.  
Unknown caller: no private business data or employee tools; customer intake only if enabled.

## Business model proposal (not validated)
Subscription pilot: $99–$149/month per company, setup $299–$499; optional website hosting at existing rates. Customer pays Twilio, OpenAI, CRM directly. Our price covers software hosting, integrations, monitoring and support; define fair-use/concurrency policies to protect GhostAI infrastructure.

## Success criteria
- A technician completes common task without logging into a dashboard.
- Successful write receipt maps to an actual CRM record ID and independent verification where supported.
- No cross-tenant reads/writes under automated isolation tests.
- Duplicate inbound webhooks do not duplicate remote writes.
- Error states show accurate remediation and never falsely claim success.
- Pilot owners report measurable admin time saved and acceptable support load.

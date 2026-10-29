# Channel and connector architecture

## Interface distinction
**Channels** deliver conversations: SMS/MMS, PSTN voice, eventually chat/WhatsApp.  
**Connectors** expose business capabilities: optional Jobber, Pool Boy, calendar, accounting, GhostAI-native notes/tasks.

Neither Twilio nor Jobber belongs in core agent logic. Provider names and API schemas are hidden behind adapters.

## Tenant channel connection contract
```ts
interface ChannelConnection {
  tenantId: string;
  provider: "twilio" | string;
  providerAccountId: string;
  ownedPhoneNumber: string;
  secretReference: string;
  configuredCapabilities: ("sms"|"mms"|"voice")[];
  state: "pending"|"healthy"|"degraded"|"disabled";
}
```
Inbound webhook must resolve precisely one active tenant from trusted account + destination/number mapping. Never select a tenant from the sender's claim. Verify signatures, replay IDs, call lifecycle and content type before model invocation. A provider-owned account is customer-billed; GhostAI supplies public webhook URLs and setup validation. U.S. automated/business SMS requires applicable A2P 10DLC registration and consent/opt-out handling; rules and pricing must be verified during implementation.

## Connector manifest (illustrative)
```json
{
  "connector_id": "jobber",
  "display_name": "Jobber",
  "status": "optional",
  "auth": "oauth2",
  "capabilities": [
    "customer.search",
    "service_request.create"
  ],
  "availability": "verify_live_api_before_enabling",
  "operations": {
    "service_request.create": {
      "risk": "SENSITIVE",
      "roles": ["owner", "crew_lead"],
      "verification": "read_back_if_supported"
    }
  }
}
```
This is a planning manifest, NOT a claim that any specific Jobber API mutation is available. Implement actual provider schemas and licensing constraints after verification.

## Generic operations
- `customer.search`, `property.search`
- `schedule.read`
- `job.read`, `job.note.add` (per-connector support)
- `service_request.create`
- `quote.read`, `followup.draft`
- `business_note.create` (GhostAI-native)
- `photo.attach` only where supported
- `customer_message.send` explicitly gated by consent, owner policy and approval

Registration contract: capability exists only if connector is connected, authorized, supported and healthy. If no provider supports the requested action, report inability and offer internal note when appropriate; do not simulate completed CRM update.

## Twilio SMS pipeline
`Webhook -> signature verification -> dedupe -> tenant/actor resolution -> durable inbound event -> agent/Gateway -> receipt -> outbound queue -> Twilio -> delivery tracking`.
Reply STOP/HELP and opt-in consent must be handled per channel/campaign rules. Inbound MMS media should be downloaded securely with authenticated credentials, virus/content-type checked, stored private, and deleted per retention policy.

## Twilio voice pipeline
`Incoming call -> signed webhook -> TwiML/stream setup -> WebSocket media bridge -> Realtime speech -> agent tool requests -> Gateway -> spoken confirmation -> call teardown`.
Keep spoken confirmations short. Handle interruption, voicemail/failed provider, hangup, session timeout and one-party/recording disclosure policies. A web request alone is not a voice call transport.

## BYO OpenAI
Customer creates own API project, sets payment method and project limits, issues minimum-privilege key and enters it through secure setup. GhostAI validates key with limited authorized test; server looks up encrypted key by tenant at execution. Customer billed by OpenAI; GhostAI maintains per-customer request/token/error/estimated spend telemetry **for GhostAI's own calls only**. Do not use project budget dashboards as guaranteed hard spending caps.

## First connector decision
Start with `business_note.create` (native) and ONE external provider, selected based on live access and pilot demand. Pool Boy may be best for proving end-to-end control quickly; Jobber is commercially attractive but has separate app approval requirements when connecting more accounts. Do not block core launch on Jobber. Build conformance tests with a fake connector before either provider.

## Provider certification tests
Auth expiry/revocation; field and scope restrictions; pagination/cursor; schema changes; idempotency; no-write mock mode; rate-limit and retry policy; write-then-read verification; ambiguous outcome; API outage; permission changes; tenant-specific error isolation.

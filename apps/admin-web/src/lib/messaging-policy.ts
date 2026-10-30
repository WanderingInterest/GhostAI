// Public copy only. Shared with the backend so the text a person accepts is
// exactly the version written to the consent event. No server code is imported.
import policy from "../../../../functions/src/messaging-policy.json";
export default policy;
export const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "";
export const smsNumber = process.env.NEXT_PUBLIC_SMS_NUMBER || "";

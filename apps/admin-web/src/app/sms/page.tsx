import type { Metadata } from "next";
import { PolicyShell } from "@/components/policy-shell";
import { SmsConsent } from "@/components/sms-consent";
export const metadata: Metadata = { title: "SMS preferences | GhostAI" };
export default function SmsPage() {
  return (
    <PolicyShell
      title="Your SMS preferences"
      eyebrow="YOUR PHONE. YOUR CHOICE."
    >
      <SmsConsent />
    </PolicyShell>
  );
}

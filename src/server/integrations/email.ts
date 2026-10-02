import { ProviderNotConfiguredError } from "./errors";

/** Email send wrapper, scaffolded ahead of a real provider per guide §16.
 * Implemented against Resend (https://resend.com/docs/api-reference/emails/send-email)
 * — a single POST with Bearer auth, simplest REST shape to scaffold without a
 * live account. Swap providers by editing just this file; nothing else in
 * the app talks to Resend directly. Not verified against a live account —
 * re-check once RESEND_API_KEY/EMAIL_FROM_ADDRESS are set.
 */

const API_BASE = "https://api.resend.com";

function getConfig(): { apiKey: string; from: string } {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;
  if (!apiKey || !from) {
    throw new ProviderNotConfiguredError(
      "Email (Resend)",
      ["RESEND_API_KEY", "EMAIL_FROM_ADDRESS"].filter((v) => !process.env[v])
    );
  }
  return { apiKey, from };
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM_ADDRESS);
}

export async function sendEmail(input: { to: string; subject: string; body: string }): Promise<{ externalId: string | null }> {
  const { apiKey, from } = getConfig();

  const res = await fetch(`${API_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.body,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Resend API error: ${data.message ?? res.statusText}`);
  }
  return { externalId: data.id ?? null };
}

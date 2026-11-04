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

/** The sender address only — never the API key. Safe to send to the client
 * (it's the address recipients see in their inbox anyway), unlike
 * RESEND_API_KEY which must never leave the server. */
export function getEmailSenderAddress(): string | null {
  return process.env.EMAIL_FROM_ADDRESS ?? null;
}

export type OutboundAttachment = { filename: string; mimeType: string; bytes: Uint8Array };

/** bodyHtml, when provided, must already be sanitized by the caller (see
 * lib/emailHtml.ts) — this function has no opinion on sanitization, it
 * just forwards it to Resend's API alongside the plain-text fallback.
 * Resend (like every real mail client) prefers the html part when both are
 * present; text is what shows for a plain-text-only recipient/client.
 * attachments bytes must already be validated/size-checked by the caller
 * (see lib/emailAttachments.ts) — this function only base64-encodes and
 * forwards them, same division of responsibility as bodyHtml above. */
export async function sendEmail(
  input: { to: string; subject: string; bodyText: string; bodyHtml?: string | null; attachments?: OutboundAttachment[] }
): Promise<{ externalId: string | null }> {
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
      text: input.bodyText,
      ...(input.bodyHtml ? { html: input.bodyHtml } : {}),
      ...(input.attachments?.length
        ? { attachments: input.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.bytes).toString("base64") })) }
        : {}),
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Resend API error: ${data.message ?? res.statusText}`);
  }
  return { externalId: data.id ?? null };
}

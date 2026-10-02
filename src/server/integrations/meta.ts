import { createHmac, timingSafeEqual } from "crypto";
import { ProviderNotConfiguredError } from "./errors";

/** Meta (Messenger/Instagram) wrapper, scaffolded ahead of a real Meta
 * Developer App + Page connection per guide §16. Implements the documented
 * webhook verification handshake, the X-Hub-Signature-256 payload signature
 * check, and the Graph API Send message call
 * (https://developers.facebook.com/docs/messenger-platform/reference/send-api).
 * Not verified against a live app/page — re-check once credentials exist.
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export function isMetaConfigured(): boolean {
  return Boolean(process.env.META_APP_SECRET && process.env.META_PAGE_ACCESS_TOKEN && process.env.META_WEBHOOK_VERIFY_TOKEN);
}

/** GET /api/webhooks/meta verification handshake: Meta calls this once when
 * you register the webhook URL in the Developer App dashboard. */
export function verifyWebhookChallenge(mode: string | null, token: string | null, challenge: string | null): string | null {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) throw new ProviderNotConfiguredError("Meta", ["META_WEBHOOK_VERIFY_TOKEN"]);
  if (mode === "subscribe" && token === verifyToken && challenge) return challenge;
  return null;
}

/** Validates the X-Hub-Signature-256 header Meta sends on every webhook POST
 * — must be checked against the *raw* request body before JSON parsing. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) throw new ProviderNotConfiguredError("Meta", ["META_APP_SECRET"]);
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export async function sendMessage(recipientPsid: string, text: string): Promise<void> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new ProviderNotConfiguredError("Meta", ["META_PAGE_ACCESS_TOKEN"]);

  const res = await fetch(`${GRAPH_API_BASE}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      message: { text },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Meta Graph API error: ${data.error?.message ?? res.statusText}`);
  }
}

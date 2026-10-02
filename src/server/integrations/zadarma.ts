import { createHash, createHmac } from "crypto";
import { ProviderNotConfiguredError } from "./errors";

/** Zadarma click-to-call wrapper, scaffolded ahead of a real account per
 * guide §16 — the API key/secret aren't set yet, so every call here throws
 * ProviderNotConfiguredError until the product owner adds them.
 *
 * Signing follows Zadarma's documented REST API auth scheme
 * (https://zadarma.com/en/support/api/): sort params, md5 the param string,
 * HMAC-SHA1(secret, method + params + md5), then base64 the *hex* digest
 * (not the raw bytes — that's a Zadarma-specific quirk). This has not been
 * verified against a live account; re-check against Zadarma's docs/a real
 * request once ZADARMA_API_KEY/ZADARMA_API_SECRET are set.
 */

const API_BASE = "https://api.zadarma.com";

function getCredentials(): { key: string; secret: string } {
  const key = process.env.ZADARMA_API_KEY;
  const secret = process.env.ZADARMA_API_SECRET;
  if (!key || !secret) {
    throw new ProviderNotConfiguredError("Zadarma", ["ZADARMA_API_KEY", "ZADARMA_API_SECRET"].filter((v) => !process.env[v]));
  }
  return { key, secret };
}

export function isZadarmaConfigured(): boolean {
  return Boolean(process.env.ZADARMA_API_KEY && process.env.ZADARMA_API_SECRET);
}

function sign(method: string, params: Record<string, string>, secret: string): string {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");
  const md5Params = createHash("md5").update(paramString).digest("hex");
  const stringToSign = method + paramString + md5Params;
  const hmacHex = createHmac("sha1", secret).update(stringToSign).digest("hex");
  return Buffer.from(hmacHex).toString("base64");
}

async function request(method: string, params: Record<string, string> = {}): Promise<unknown> {
  const { key, secret } = getCredentials();
  const signature = sign(method, params, secret);
  const query = new URLSearchParams(params).toString();
  const url = `${API_BASE}${method}${query ? `?${query}` : ""}`;

  const res = await fetch(url, {
    headers: { Authorization: `${key}:${signature}` },
  });
  const body = await res.json();
  if (!res.ok || body.status === "error") {
    throw new Error(`Zadarma API error: ${body.message ?? res.statusText}`);
  }
  return body;
}

/** "Request a callback" — Zadarma dials `from` first, then bridges to `to`
 * once answered. This is the click-to-call primitive; it doesn't require an
 * embedded WebRTC widget, so it's the right first piece to scaffold. */
export async function requestCallback(from: string, to: string): Promise<void> {
  await request("/v1/request/callback/", { from, to });
}

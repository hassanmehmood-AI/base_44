import { createHmac, randomBytes } from "node:crypto";

const STATE_TTL_MS = 10 * 60_000; // 10 minutes — long enough for a user to actually complete Google's consent screen

/** Short-lived, signed OAuth `state` parameter — same HMAC-over-AUTH_SECRET
 * shape as impersonationTicket.ts, for the same reason: lets the callback
 * route trust which company/issuer requested this authorization without
 * needing a server-side session store for in-flight OAuth attempts. A
 * random nonce is included (unused beyond padding the signed payload) so
 * two authorization attempts for the same company in quick succession
 * don't produce byte-identical state values. */
export type GoogleOAuthStatePayload = { companyId: string; issuerId: string };

export function signGoogleOAuthState(payload: GoogleOAuthStatePayload): string {
  const nonce = randomBytes(8).toString("hex");
  const raw = [payload.companyId, payload.issuerId, nonce, Date.now()].join("|");
  const sig = createHmac("sha256", process.env.AUTH_SECRET!).update(raw).digest("hex");
  return Buffer.from(`${raw}.${sig}`).toString("base64url");
}

export function verifyGoogleOAuthState(state: string): GoogleOAuthStatePayload | null {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const lastDot = decoded.lastIndexOf(".");
  if (lastDot === -1) return null;
  const raw = decoded.slice(0, lastDot);
  const sig = decoded.slice(lastDot + 1);

  const expectedSig = createHmac("sha256", process.env.AUTH_SECRET!).update(raw).digest("hex");
  if (sig.length !== expectedSig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  if (diff !== 0) return null;

  const [companyId, issuerId, , tsStr] = raw.split("|");
  const ts = Number(tsStr);
  if (!ts || Date.now() - ts > STATE_TTL_MS) return null;
  if (!companyId || !issuerId) return null;

  return { companyId, issuerId };
}

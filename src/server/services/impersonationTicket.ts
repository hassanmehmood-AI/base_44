import { createHmac } from "node:crypto";

const TICKET_TTL_MS = 15_000;

/** Short-lived, signed, single-purpose capability token — lets the "impersonate"
 * Credentials provider's authorize() trust that a real, already-verified server
 * action (which checked the caller's actual session via auth()) approved this
 * exact switch, without authorize() needing to re-derive the ambient session
 * itself (which would depend on next-auth internals this app doesn't otherwise
 * rely on). Signed with AUTH_SECRET; expires in 15s; not reusable across modes. */
export type TicketPayload = { mode: "start" | "stop"; issuerId: string; targetId?: string };

export function signImpersonationTicket(payload: TicketPayload): string {
  const raw = [payload.mode, payload.issuerId, payload.targetId ?? "", Date.now()].join("|");
  const sig = createHmac("sha256", process.env.AUTH_SECRET!).update(raw).digest("hex");
  return `${raw}.${sig}`;
}

export function verifyImpersonationTicket(ticket: string): TicketPayload | null {
  const lastDot = ticket.lastIndexOf(".");
  if (lastDot === -1) return null;
  const raw = ticket.slice(0, lastDot);
  const sig = ticket.slice(lastDot + 1);

  const expectedSig = createHmac("sha256", process.env.AUTH_SECRET!).update(raw).digest("hex");
  if (sig.length !== expectedSig.length) return null;
  // constant-time-ish compare is overkill for a 15s-lived internal ticket, but cheap to do right
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  if (diff !== 0) return null;

  const [mode, issuerId, targetId, tsStr] = raw.split("|");
  const ts = Number(tsStr);
  if (!ts || Date.now() - ts > TICKET_TTL_MS) return null;
  if (mode !== "start" && mode !== "stop") return null;
  if (!issuerId) return null;

  return { mode, issuerId, targetId: targetId || undefined };
}

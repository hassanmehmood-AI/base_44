import { getDb } from "@/db";
import * as zadarmaCallEventsRepo from "@/server/repositories/zadarmaCallEvents";
import type { ZadarmaCallEvent } from "@/server/repositories/zadarmaCallEvents";
import * as zadarmaNumbersRepo from "@/server/repositories/zadarmaNumbers";
import * as zadarmaExtensionsRepo from "@/server/repositories/zadarmaExtensions";
import * as contactsRepo from "@/server/repositories/contacts";
import * as callsRepo from "@/server/repositories/calls";
import * as activitiesRepo from "@/server/repositories/activities";
import * as zadarmaProvider from "@/server/integrations/zadarma";
import type { CallDirection, CallStatus } from "@/server/constants";

/** Turns verified Zadarma PBX webhook events into automatic `calls` history
 * — the real-integration counterpart to whatsapp.ts's
 * stagePendingEvents/processPendingWhapiEvents, same durable-staging shape.
 *
 * IMPORTANT, stated plainly rather than glossed over: this has never been
 * exercised against a real Zadarma webhook delivery, because no webhook
 * subscription has been registered on the account yet (that's a one-time
 * Zadarma-side configuration step, deliberately not done as part of this
 * phase). The signature scheme (zadarma.ts's verifyWebhookSignature) and
 * the field names read below (caller_id/called_did/destination/internal/
 * duration/disposition/call_start/pbx_call_id) are the best evidence
 * available from Zadarma's own SDK source, not a confirmed live shape —
 * every field is read defensively (?. / ?? fallbacks) so a missing or
 * renamed field degrades to "couldn't auto-log this one," never a crash
 * and never a fabricated value. */

/** Strips everything but digits — the same "normalize don't guess" idiom
 * contacts.ts's findEmailsAndPhonesByCompanyId already documents for phone
 * matching (numbers aren't stored normalized in this app). Exported for
 * tests. */
export function normalizePhoneDigits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/** Matches two phone numbers that may differ only by a leading `+`,
 * spacing, or a leading country-code/trunk digit some providers add or drop
 * — exact digit-suffix comparison, never a fuzzy/partial match shorter than
 * 7 digits (too easy to collide). Exported for tests. */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (da.length < 7 || db.length < 7) return false;
  const shorter = da.length <= db.length ? da : db;
  const longer = da.length <= db.length ? db : da;
  return longer.endsWith(shorter);
}

/** Zadarma's documented `disposition` values (per its API reference) mapped
 * to this app's own CallStatus enum. Returns null for an unrecognized
 * value — callers must never guess a status for a disposition they don't
 * actually recognize. Exported for tests. */
export function mapDispositionToStatus(disposition: string | undefined): CallStatus | null {
  switch (disposition) {
    case "answered":
      return "COMPLETED";
    case "no_answer":
      return "NO_ANSWER";
    case "busy":
    case "failed":
    case "cancel":
      return "FAILED";
    default:
      return null;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}

/** The webhook route's ONLY job for each inbound notification: verify the
 * signature, then get it durably staged before attempting anything else.
 * Returns false (never throws) when the signature doesn't check out — the
 * route must reject the request without this function's caller ever
 * reaching the staging insert. */
export function verifySignature(eventType: string, fields: Record<string, string | undefined>, signatureHeader: string | null): boolean {
  return zadarmaProvider.verifyWebhookSignature(eventType, fields, signatureHeader);
}

export async function stageEvent(eventType: string, fields: Record<string, string | undefined>): Promise<ZadarmaCallEvent> {
  const pbxCallId = fields.pbx_call_id ?? null;
  return zadarmaCallEventsRepo.insertPending(eventType, pbxCallId, fields);
}

const MAX_PROCESS_ATTEMPTS = 5;

/** Mirrors whatsapp.ts's processPendingWhapiEvents exactly: safe to call
 * repeatedly/overlapping (claim's conditional UPDATE means only one caller
 * ever wins a given row), bounded retry count before giving up. */
export async function processPendingCallEvents(limit = 25): Promise<{ attempted: number; processed: number; abandoned: number; failed: number; autoLogged: number }> {
  const pending = await zadarmaCallEventsRepo.findPending(limit);
  let processed = 0;
  let abandoned = 0;
  let failed = 0;
  let autoLogged = 0;

  for (const candidate of pending) {
    const claimed = await zadarmaCallEventsRepo.claim(candidate.id);
    if (!claimed) continue;

    try {
      const logged = await processOneEvent(claimed);
      if (logged) autoLogged++;
      await zadarmaCallEventsRepo.markProcessed(claimed.id);
      processed++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : "Unknown error.";
      if (claimed.attempts + 1 >= MAX_PROCESS_ATTEMPTS) {
        await zadarmaCallEventsRepo.markAbandoned(claimed.id, message);
        abandoned++;
      } else {
        await zadarmaCallEventsRepo.recordAttemptFailure(claimed.id, message);
      }
      console.error(`[zadarma webhook] failed to process event ${claimed.id} (attempt ${claimed.attempts + 1}):`, e);
    }
  }

  return { attempted: pending.length, processed, abandoned, failed, autoLogged };
}

/** Only NOTIFY_END (inbound finished) and NOTIFY_OUT_END (outbound
 * finished) carry enough information to auto-log a `calls` row — every
 * other event type (START/INTERNAL/ANSWER/RECORD) is durably staged above
 * but has no further action here YET; it's marked PROCESSED with no side
 * effect rather than silently dropped, so the staged payload stays
 * available for whenever a later phase needs it (e.g. a recording-URL
 * lookup off NOTIFY_RECORD). Returns true iff a `calls` row was actually
 * created. */
async function processOneEvent(event: ZadarmaCallEvent): Promise<boolean> {
  const fields = event.rawPayload as Record<string, string | undefined>;
  if (event.eventType === "NOTIFY_END") return autoLogInboundCall(fields);
  if (event.eventType === "NOTIFY_OUT_END") return autoLogOutboundCall(fields);
  return false;
}

async function createCallFromMatch(input: {
  companyId: string;
  counterpartNumber: string;
  direction: CallDirection;
  disposition: string | undefined;
  duration: string | undefined;
  pbxCallId: string | null;
  startedAt: Date;
  /** The agent who owns the SIP extension this call went through, if known
   * — only ever resolvable for outbound calls (via zadarma_extensions'
   * userId). Inbound calls still have no "agent" to attribute to until
   * someone actually answers, so this stays undefined for those. */
  calledByUserId?: string;
}): Promise<boolean> {
  const status = mapDispositionToStatus(input.disposition);
  if (!status) return false; // unrecognized disposition — never guess

  const candidates = await contactsRepo.findIdsAndPhonesByCompanyId(input.companyId);
  const match = candidates.find((c) => phonesMatch(c.phone, input.counterpartNumber));
  if (!match) return false; // no existing contact — documented limitation, never fabricate one

  const durationSeconds = input.duration ? Number.parseInt(input.duration, 10) : null;

  try {
    const call = await callsRepo.create({
      companyId: input.companyId,
      contactId: match.id,
      direction: input.direction,
      phoneNumber: input.counterpartNumber,
      status,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      outcome: null,
      notes: "Auto-logged from a verified Zadarma webhook.",
      calledBy: input.calledByUserId ?? null,
      startedAt: input.startedAt,
      endedAt: new Date(),
      pbxCallId: input.pbxCallId,
    });
    // An activity-timeline entry is only created when there's a real user
    // to attribute it to (activities.createdBy is NOT NULL) — i.e. outbound
    // calls resolved to the agent's own extension. Inbound calls still have
    // no agent to attribute to at this point, so they only get the `calls`
    // row, not a timeline entry — documented limitation, not an oversight.
    if (input.calledByUserId) {
      await activitiesRepo.create(getDb(), {
        companyId: input.companyId,
        contactId: match.id,
        type: "CALL",
        channel: "CALL",
        outcome: null,
        notes: "Auto-logged from a verified Zadarma webhook.",
        createdBy: input.calledByUserId,
      });
    }
    return Boolean(call);
  } catch (e) {
    if (isUniqueViolation(e)) return false; // already logged by a prior/overlapping delivery of this same call — not an error
    throw e;
  }
}

/** NOTIFY_END: caller_id is the external party, called_did is the
 * company's own Zadarma number that was dialed — resolved to a company via
 * zadarmaNumbersRepo.findActiveByNumber (the reverse of calls.ts's own
 * company->number lookup). */
async function autoLogInboundCall(fields: Record<string, string | undefined>): Promise<boolean> {
  const calledDid = fields.called_did;
  const callerId = fields.caller_id;
  if (!calledDid || !callerId) return false;

  const number = await zadarmaNumbersRepo.findActiveByNumber(calledDid);
  if (!number?.companyId) return false;

  const callStart = fields.call_start ? new Date(fields.call_start) : new Date();
  return createCallFromMatch({
    companyId: number.companyId,
    counterpartNumber: callerId,
    direction: "INBOUND",
    disposition: fields.disposition,
    duration: fields.duration,
    pbxCallId: fields.pbx_call_id ?? null,
    startedAt: Number.isNaN(callStart.getTime()) ? new Date() : callStart,
  });
}

/** NOTIFY_OUT_END: `internal` is the agent's own SIP extension (not a phone
 * number) — resolved to a company via the extension this CRM itself
 * created in Phase 1 (zadarma_extensions), never a phone-number lookup,
 * since the Caller ID isn't one of this event's documented fields.
 * `destination` is the external party that was called. */
async function autoLogOutboundCall(fields: Record<string, string | undefined>): Promise<boolean> {
  const internal = fields.internal;
  const destination = fields.destination;
  if (!internal || !destination) return false;

  const extensions = await zadarmaExtensionsRepo.findAll();
  const extension = extensions.find((e) => e.sipExtension === internal && e.status === "ACTIVE");
  if (!extension?.companyId) return false;

  const callStart = fields.call_start ? new Date(fields.call_start) : new Date();
  return createCallFromMatch({
    companyId: extension.companyId,
    counterpartNumber: destination,
    direction: "OUTBOUND",
    disposition: fields.disposition,
    duration: fields.duration,
    pbxCallId: fields.pbx_call_id ?? null,
    startedAt: Number.isNaN(callStart.getTime()) ? new Date() : callStart,
    calledByUserId: extension.userId ?? undefined,
  });
}

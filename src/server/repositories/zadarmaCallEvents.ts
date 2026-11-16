import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { zadarmaCallEvents } from "@/db/schema";

export type ZadarmaCallEvent = typeof zadarmaCallEvents.$inferSelect;

/** Durable staging insert — called from the webhook route AFTER its
 * signature has already been verified, BEFORE any attempt to turn this
 * event into a `calls` row (see schema.ts's doc comment on this table). No
 * uniqueness is enforced at insert time (unlike whapi_inbound_events' id-
 * based dedup) — Zadarma's events don't carry a single reliable per-delivery
 * id the way a WhatsApp message does, so a redelivered event is instead
 * made safe at the OUTPUT side: calls.pbxCallId's unique index means a
 * second successful processing attempt for the same call can never create
 * a second `calls` row. */
export async function insertPending(eventType: string, pbxCallId: string | null, rawPayload: unknown): Promise<ZadarmaCallEvent> {
  const [row] = await getDb()
    .insert(zadarmaCallEvents)
    .values({ eventType, pbxCallId, rawPayload, status: "PENDING" })
    .returning();
  return row;
}

export async function findPending(limit: number): Promise<ZadarmaCallEvent[]> {
  return getDb().select().from(zadarmaCallEvents).where(eq(zadarmaCallEvents.status, "PENDING")).limit(limit);
}

/** Same atomic-claim pattern as whapiInboundEventsRepo.claim: bumps the
 * attempt count and re-checks status='PENDING' in the same statement, so
 * two overlapping processing passes can never both process the same
 * event. */
export async function claim(id: string): Promise<ZadarmaCallEvent | undefined> {
  const [row] = await getDb()
    .update(zadarmaCallEvents)
    .set({ attempts: sql`${zadarmaCallEvents.attempts} + 1` })
    .where(and(eq(zadarmaCallEvents.id, id), eq(zadarmaCallEvents.status, "PENDING")))
    .returning();
  return row;
}

export async function markProcessed(id: string): Promise<void> {
  await getDb()
    .update(zadarmaCallEvents)
    .set({ status: "PROCESSED", processedAt: new Date() })
    .where(eq(zadarmaCallEvents.id, id));
}

export async function recordAttemptFailure(id: string, lastError: string): Promise<void> {
  await getDb().update(zadarmaCallEvents).set({ lastError }).where(eq(zadarmaCallEvents.id, id));
}

export async function markAbandoned(id: string, lastError: string): Promise<void> {
  await getDb().update(zadarmaCallEvents).set({ status: "ABANDONED", lastError }).where(eq(zadarmaCallEvents.id, id));
}

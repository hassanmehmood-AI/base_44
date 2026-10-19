import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { whapiInboundEvents } from "@/db/schema";

export type WhapiInboundEvent = typeof whapiInboundEvents.$inferSelect;

/** Durable staging insert — called from the webhook route BEFORE any attempt
 * to turn this event into a conversation/message (see schema.ts's doc
 * comment on this table). The unique index on (whapiChannelId,
 * externalMessageId) makes a duplicate webhook delivery (Whapi's own retry,
 * or a genuine duplicate network delivery) a harmless no-op here — callers
 * should treat a unique-violation as "already staged," not an error. */
export async function insertPending(whapiChannelId: string, externalMessageId: string, rawPayload: unknown): Promise<WhapiInboundEvent> {
  const [row] = await getDb()
    .insert(whapiInboundEvents)
    .values({ whapiChannelId, externalMessageId, rawPayload, status: "PENDING" })
    .returning();
  return row;
}

export async function findPending(limit: number): Promise<WhapiInboundEvent[]> {
  return getDb().select().from(whapiInboundEvents).where(eq(whapiInboundEvents.status, "PENDING")).limit(limit);
}

/** Same atomic-claim pattern as conversationsRepo.claimPendingAvatarCapture:
 * bumps the attempt count and re-checks status='PENDING' in the same
 * statement, so two overlapping processing passes (the webhook route's own
 * after() dispatch and the sweep cron) can never both process the same
 * event. */
export async function claim(id: string): Promise<WhapiInboundEvent | undefined> {
  const [row] = await getDb()
    .update(whapiInboundEvents)
    .set({ attempts: sql`${whapiInboundEvents.attempts} + 1` })
    .where(and(eq(whapiInboundEvents.id, id), eq(whapiInboundEvents.status, "PENDING")))
    .returning();
  return row;
}

export async function markProcessed(id: string): Promise<void> {
  await getDb()
    .update(whapiInboundEvents)
    .set({ status: "PROCESSED", processedAt: new Date() })
    .where(eq(whapiInboundEvents.id, id));
}

export async function recordAttemptFailure(id: string, lastError: string): Promise<void> {
  await getDb().update(whapiInboundEvents).set({ lastError }).where(eq(whapiInboundEvents.id, id));
}

export async function markAbandoned(id: string, lastError: string): Promise<void> {
  await getDb().update(whapiInboundEvents).set({ status: "ABANDONED", lastError }).where(eq(whapiInboundEvents.id, id));
}

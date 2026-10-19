import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { whapiChannels } from "@/db/schema";

export type WhapiChannel = typeof whapiChannels.$inferSelect;

export async function findByCompanyId(companyId: string): Promise<WhapiChannel | undefined> {
  const [row] = await getDb().select().from(whapiChannels).where(eq(whapiChannels.companyId, companyId)).limit(1);
  return row;
}

export async function findByCompanyIds(companyIds: string[]): Promise<WhapiChannel[]> {
  if (companyIds.length === 0) return [];
  return getDb().select().from(whapiChannels).where(inArray(whapiChannels.companyId, companyIds));
}

export async function findById(id: string): Promise<WhapiChannel | undefined> {
  const [row] = await getDb().select().from(whapiChannels).where(eq(whapiChannels.id, id)).limit(1);
  return row;
}

export async function findByChannelId(channelId: string): Promise<WhapiChannel | undefined> {
  const [row] = await getDb().select().from(whapiChannels).where(eq(whapiChannels.channelId, channelId)).limit(1);
  return row;
}

/** The duplicate-paid-channel guard: INSERT a PENDING placeholder BEFORE any
 * Whapi API call is made. The unique index on companyId (see db/schema.ts)
 * means a double-click, a browser retrying a slow request, or two
 * Superusers acting on the same company at once can only ever have ONE of
 * those attempts succeed here — every other caller gets a unique-violation
 * and must treat it as "already provisioning/provisioned", never proceed to
 * call Whapi's paid create-channel endpoint. Callers check for the
 * unique-violation error code (see whapiOnboarding.ts's isUniqueViolation). */
export async function insertPending(companyId: string): Promise<WhapiChannel> {
  const [row] = await getDb().insert(whapiChannels).values({ companyId, status: "PENDING" }).returning();
  return row;
}

export async function markActive(
  id: string,
  data: { channelId: string; apiUrl: string; encryptedToken: string; encryptedWebhookSecret: string }
): Promise<WhapiChannel> {
  const [row] = await getDb()
    .update(whapiChannels)
    .set({ ...data, status: "ACTIVE", lastError: null, updatedAt: new Date() })
    .where(eq(whapiChannels.id, id))
    .returning();
  return row;
}

/** For the one failure mode where a real, billable Whapi channel definitely
 * exists but this row can't be marked ACTIVE yet (webhook registration
 * failed after createChannel already succeeded — see
 * whapiOnboarding.ts's provisionClaimedRow) — persists the channel's real
 * id/apiUrl/token alongside FAILED_NEEDS_MANUAL_CHECK instead of discarding
 * them, so the channel this company is already being billed for is never
 * orphaned/untracked, and a future "retry just the webhook" action has what
 * it needs without calling createChannel (and paying for a second channel)
 * again. */
export async function markNeedsManualCheck(
  id: string,
  data: { channelId: string; apiUrl: string; encryptedToken: string; lastError: string }
): Promise<void> {
  await getDb()
    .update(whapiChannels)
    .set({
      channelId: data.channelId,
      apiUrl: data.apiUrl,
      encryptedToken: data.encryptedToken,
      status: "FAILED_NEEDS_MANUAL_CHECK",
      lastError: data.lastError,
      updatedAt: new Date(),
    })
    .where(eq(whapiChannels.id, id));
}

export async function markFailed(id: string, status: "FAILED" | "FAILED_NEEDS_MANUAL_CHECK", lastError: string): Promise<void> {
  await getDb()
    .update(whapiChannels)
    .set({ status, lastError, updatedAt: new Date() })
    .where(eq(whapiChannels.id, id));
}

/** Atomically claims a FAILED (never FAILED_NEEDS_MANUAL_CHECK — see
 * whapiOnboarding.ts) row for a retry attempt, flipping it back to PENDING
 * in the same statement. The WHERE clause re-checking status='FAILED' is
 * what makes two concurrent retry clicks safe without an extra lock: only
 * the first UPDATE's WHERE still matches (the row is no longer 'FAILED' by
 * the time the second one runs), so it returns no row and the caller treats
 * that as "someone else is already retrying this." */
export async function claimForRetry(companyId: string): Promise<WhapiChannel | undefined> {
  const [row] = await getDb()
    .update(whapiChannels)
    .set({ status: "PENDING", updatedAt: new Date() })
    .where(and(eq(whapiChannels.companyId, companyId), eq(whapiChannels.status, "FAILED")))
    .returning();
  return row;
}

/** A Superuser confirming (outside this app, via the Whapi partner
 * dashboard) that an ambiguous create-channel failure did NOT actually
 * create a paid channel — only this moves FAILED_NEEDS_MANUAL_CHECK back to
 * a normal FAILED that claimForRetry can then pick up. Never automatic. */
export async function acknowledgeManualCheck(companyId: string): Promise<WhapiChannel | undefined> {
  const [row] = await getDb()
    .update(whapiChannels)
    .set({ status: "FAILED", updatedAt: new Date() })
    .where(and(eq(whapiChannels.companyId, companyId), eq(whapiChannels.status, "FAILED_NEEDS_MANUAL_CHECK")))
    .returning();
  return row;
}

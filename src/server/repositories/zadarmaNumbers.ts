import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { zadarmaNumbers } from "@/db/schema";

export type ZadarmaNumber = typeof zadarmaNumbers.$inferSelect;

export async function findById(id: string): Promise<ZadarmaNumber | undefined> {
  const [row] = await getDb().select().from(zadarmaNumbers).where(eq(zadarmaNumbers.id, id)).limit(1);
  return row;
}

/** The company's current ACTIVE number, if any — what initiateCall (Phase 3)
 * resolves against. A company can have FAILED/older rows too; those are
 * never considered here. */
export async function findActiveByCompanyId(companyId: string): Promise<ZadarmaNumber | undefined> {
  const [row] = await getDb()
    .select()
    .from(zadarmaNumbers)
    .where(and(eq(zadarmaNumbers.companyId, companyId), eq(zadarmaNumbers.status, "ACTIVE")))
    .limit(1);
  return row;
}

/** Reverse lookup: given a phone number Zadarma's webhook says was DIALED
 * (an inbound call's `called_did`), which company owns it — the inverse of
 * findActiveByCompanyId, used by zadarmaCallEvents.ts to resolve an
 * incoming NOTIFY_END event to a company before trying to match a contact.
 * Only ACTIVE rows are considered, same as every other number lookup here. */
export async function findActiveByNumber(number: string): Promise<ZadarmaNumber | undefined> {
  const [row] = await getDb()
    .select()
    .from(zadarmaNumbers)
    .where(and(eq(zadarmaNumbers.number, number), eq(zadarmaNumbers.status, "ACTIVE")))
    .limit(1);
  return row;
}

/** Looks up a real phone number against every row this CRM has ever
 * tracked (any status) — used by "Add Existing Number" to give a clear
 * "already assigned to X" message instead of a raw unique-violation. The
 * real guarantee is still the global unique index on `number`. */
export async function findByNumber(number: string): Promise<ZadarmaNumber | undefined> {
  const [row] = await getDb().select().from(zadarmaNumbers).where(eq(zadarmaNumbers.number, number)).limit(1);
  return row;
}

export async function findByCompanyIds(companyIds: string[]): Promise<ZadarmaNumber[]> {
  if (companyIds.length === 0) return [];
  return getDb().select().from(zadarmaNumbers).where(inArray(zadarmaNumbers.companyId, companyIds));
}

/** Every number this CRM has ever attempted to purchase, for the "existing
 * numbers" management view (requirement #8) — including unassigned and
 * failed ones, not just ACTIVE. */
export async function findAll(): Promise<ZadarmaNumber[]> {
  return getDb().select().from(zadarmaNumbers);
}

/** The duplicate-paid-purchase guard: INSERT a PENDING placeholder BEFORE
 * any Zadarma order/ call is made. The partial unique index on
 * (companyId WHERE status='PENDING') — see db/schema.ts — means a
 * double-click, a browser-retried slow request, or two Superusers buying
 * for the same company at once can only ever have ONE of those attempts
 * succeed here. Every other caller gets a unique-violation and must treat
 * it as "a purchase for this company is already in progress," never
 * proceed to call Zadarma's paid order/ endpoint. Callers check for the
 * unique-violation error code (see zadarmaNumberOnboarding.ts's
 * isUniqueViolation). */
export async function insertPending(input: {
  companyId: string;
  directionId: string;
  countryCode: string;
  purchasedBy: string;
}): Promise<ZadarmaNumber> {
  const [row] = await getDb()
    .insert(zadarmaNumbers)
    .values({
      companyId: input.companyId,
      directionId: input.directionId,
      countryCode: input.countryCode,
      purchasedBy: input.purchasedBy,
      status: "PENDING",
    })
    .returning();
  return row;
}

/** "Add Existing Number" — inserts directly as ACTIVE, no PENDING step and
 * no order/ call, since the number already exists on the account; this
 * only ever records it. directionId/countryCode are left null (see
 * db/schema.ts's comment on those columns) — Zadarma's real owned-numbers
 * response has no direction_id at all, so this never fabricates one. */
export async function insertExisting(input: {
  number: string;
  companyId: string;
  monthlyFee: string | null;
  currency: string | null;
  purchasedBy: string;
}): Promise<ZadarmaNumber> {
  const [row] = await getDb()
    .insert(zadarmaNumbers)
    .values({
      number: input.number,
      companyId: input.companyId,
      monthlyFee: input.monthlyFee,
      currency: input.currency,
      purchasedBy: input.purchasedBy,
      status: "ACTIVE",
    })
    .returning();
  return row;
}

export async function markActive(
  id: string,
  data: { number: string; monthlyFee: string | null; connectFee: string | null; currency: string | null; documentsGroupId: string | null }
): Promise<ZadarmaNumber> {
  const [row] = await getDb()
    .update(zadarmaNumbers)
    .set({ ...data, status: "ACTIVE", lastError: null, updatedAt: new Date() })
    .where(eq(zadarmaNumbers.id, id))
    .returning();
  return row;
}

export async function markFailed(id: string, status: "FAILED" | "FAILED_NEEDS_MANUAL_CHECK", lastError: string): Promise<void> {
  await getDb()
    .update(zadarmaNumbers)
    .set({ status, lastError, updatedAt: new Date() })
    .where(eq(zadarmaNumbers.id, id));
}

/** Atomically claims a FAILED (never FAILED_NEEDS_MANUAL_CHECK) row for a
 * retry attempt, flipping it back to PENDING in the same statement — same
 * race-closer as whapiChannelsRepo.claimForRetry: the WHERE clause
 * re-checking status='FAILED' means only the first of two concurrent retry
 * clicks can ever match. */
export async function claimForRetry(id: string): Promise<ZadarmaNumber | undefined> {
  const [row] = await getDb()
    .update(zadarmaNumbers)
    .set({ status: "PENDING", updatedAt: new Date() })
    .where(and(eq(zadarmaNumbers.id, id), eq(zadarmaNumbers.status, "FAILED")))
    .returning();
  return row;
}

/** A Superuser confirming (outside this app, via Zadarma's own dashboard)
 * that an ambiguous order failure did NOT actually purchase a number — only
 * this moves FAILED_NEEDS_MANUAL_CHECK back to a normal FAILED that
 * claimForRetry can then pick up. Never automatic. */
export async function acknowledgeManualCheck(id: string): Promise<ZadarmaNumber | undefined> {
  const [row] = await getDb()
    .update(zadarmaNumbers)
    .set({ status: "FAILED", updatedAt: new Date() })
    .where(and(eq(zadarmaNumbers.id, id), eq(zadarmaNumbers.status, "FAILED_NEEDS_MANUAL_CHECK")))
    .returning();
  return row;
}

/** Pure CRM-side routing change — no Zadarma API call, safe to do anytime,
 * including unassigning (null) a number entirely. Only ever applied to an
 * ACTIVE number; reassigning a PENDING/FAILED row makes no sense (it isn't
 * a real number yet). */
export async function reassignCompany(id: string, companyId: string | null): Promise<ZadarmaNumber | undefined> {
  const [row] = await getDb()
    .update(zadarmaNumbers)
    .set({ companyId, updatedAt: new Date() })
    .where(and(eq(zadarmaNumbers.id, id), eq(zadarmaNumbers.status, "ACTIVE")))
    .returning();
  return row;
}

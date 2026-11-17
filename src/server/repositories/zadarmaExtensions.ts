import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { zadarmaExtensions } from "@/db/schema";

export type ZadarmaExtension = typeof zadarmaExtensions.$inferSelect;

export async function findById(id: string): Promise<ZadarmaExtension | undefined> {
  const [row] = await getDb().select().from(zadarmaExtensions).where(eq(zadarmaExtensions.id, id)).limit(1);
  return row;
}

/** The agent's current PENDING-or-ACTIVE extension, if any — what
 * createExtensionForAgent's duplicate guard checks against before ever
 * calling Zadarma. A user can have older FAILED/REVOKED rows too; those are
 * never considered here. */
export async function findActiveOrPendingByUserId(userId: string): Promise<ZadarmaExtension | undefined> {
  const [row] = await getDb()
    .select()
    .from(zadarmaExtensions)
    .where(and(eq(zadarmaExtensions.userId, userId), inArray(zadarmaExtensions.status, ["PENDING", "ACTIVE"])))
    .limit(1);
  return row;
}

/** The one extension an agent can actually use for browser calling right
 * now — strictly ACTIVE only (unlike findActiveOrPendingByUserId's broader
 * PENDING-or-ACTIVE check used by the duplicate-creation guard). Used by
 * zadarmaWebrtcAuth.ts before ever minting a WebRTC key: no ACTIVE row,
 * no key, full stop — never falls back to a PENDING/FAILED one. */
export async function findActiveByUserId(userId: string): Promise<ZadarmaExtension | undefined> {
  const [row] = await getDb()
    .select()
    .from(zadarmaExtensions)
    .where(and(eq(zadarmaExtensions.userId, userId), eq(zadarmaExtensions.status, "ACTIVE")))
    .limit(1);
  return row;
}

/** Looks up a real SIP extension number against every row this CRM has
 * ever tracked (any status) — used by "Add Existing SIP" to give a clear
 * "already linked to X" message instead of a raw unique-violation. The
 * real guarantee is still the global unique index on sipExtension; this is
 * only a friendlier pre-check. */
export async function findBySipExtension(sipExtension: string): Promise<ZadarmaExtension | undefined> {
  const [row] = await getDb().select().from(zadarmaExtensions).where(eq(zadarmaExtensions.sipExtension, sipExtension)).limit(1);
  return row;
}

export async function findByCompanyIds(companyIds: string[]): Promise<ZadarmaExtension[]> {
  if (companyIds.length === 0) return [];
  return getDb().select().from(zadarmaExtensions).where(inArray(zadarmaExtensions.companyId, companyIds));
}

/** Every extension this CRM has ever attempted to provision, for the
 * management table — including FAILED/REVOKED, not just ACTIVE. */
export async function findAll(): Promise<ZadarmaExtension[]> {
  return getDb().select().from(zadarmaExtensions);
}

/** The duplicate-creation guard: INSERT a PENDING placeholder BEFORE any
 * Zadarma call is made. The partial unique index on zadarma_extensions
 * (userId WHERE status IN ('PENDING','ACTIVE')) — see db/schema.ts — means a
 * double-click, a retried slow request, or two Superusers provisioning for
 * the same agent at once can only ever have ONE of those attempts succeed
 * here. Every other caller gets a unique-violation and must treat it as "an
 * extension for this agent already exists or is being created," never
 * proceed to call Zadarma's create/ endpoint. Mirrors
 * zadarmaNumbersRepo.insertPending exactly. */
export async function insertPending(input: { companyId: string; userId: string; createdBy: string }): Promise<ZadarmaExtension> {
  const [row] = await getDb()
    .insert(zadarmaExtensions)
    .values({
      companyId: input.companyId,
      userId: input.userId,
      createdBy: input.createdBy,
      status: "PENDING",
    })
    .returning();
  return row;
}

/** "Add Existing SIP" — inserts directly as ACTIVE, no PENDING step, since
 * there's no creation call to wait on (the extension already exists on
 * Zadarma; this only ever records it). Caller ID is stored exactly as
 * Zadarma reported it at verification time — never forced to match the
 * target company, same "never silently modify" rule as everywhere else in
 * this feature. The global unique index on sipExtension and the partial
 * unique index on (userId WHERE status IN PENDING/ACTIVE) apply to this
 * insert exactly as they do to insertPending — a duplicate here surfaces
 * as the same unique-violation the service layer already knows to catch. */
export async function insertExisting(input: {
  companyId: string;
  userId: string;
  sipExtension: string;
  sipPasswordEncrypted: string;
  callerIdNumber: string | null;
  createdBy: string;
}): Promise<ZadarmaExtension> {
  const [row] = await getDb()
    .insert(zadarmaExtensions)
    .values({
      companyId: input.companyId,
      userId: input.userId,
      sipExtension: input.sipExtension,
      sipPasswordEncrypted: input.sipPasswordEncrypted,
      callerIdNumber: input.callerIdNumber,
      createdBy: input.createdBy,
      status: "ACTIVE",
    })
    .returning();
  return row;
}

export async function markActive(
  id: string,
  data: { sipExtension: string; sipPasswordEncrypted: string | null; callerIdNumber: string | null }
): Promise<ZadarmaExtension> {
  const [row] = await getDb()
    .update(zadarmaExtensions)
    .set({ ...data, status: "ACTIVE", lastError: null, updatedAt: new Date() })
    .where(eq(zadarmaExtensions.id, id))
    .returning();
  return row;
}

export async function markFailed(id: string, status: "FAILED" | "FAILED_NEEDS_MANUAL_CHECK", lastError: string): Promise<void> {
  await getDb()
    .update(zadarmaExtensions)
    .set({ status, lastError, updatedAt: new Date() })
    .where(eq(zadarmaExtensions.id, id));
}

/** Atomically claims a FAILED (never FAILED_NEEDS_MANUAL_CHECK) row for a
 * retry attempt, flipping it back to PENDING in the same statement — same
 * race-closer as zadarmaNumbersRepo.claimForRetry. */
export async function claimForRetry(id: string): Promise<ZadarmaExtension | undefined> {
  const [row] = await getDb()
    .update(zadarmaExtensions)
    .set({ status: "PENDING", updatedAt: new Date() })
    .where(and(eq(zadarmaExtensions.id, id), eq(zadarmaExtensions.status, "FAILED")))
    .returning();
  return row;
}

/** A Superuser confirming (outside this app, via Zadarma's own dashboard)
 * that an ambiguous create failure did NOT actually provision an extension
 * — only this moves FAILED_NEEDS_MANUAL_CHECK back to a normal FAILED that
 * claimForRetry can then pick up. Never automatic. */
export async function acknowledgeManualCheck(id: string): Promise<ZadarmaExtension | undefined> {
  const [row] = await getDb()
    .update(zadarmaExtensions)
    .set({ status: "FAILED", updatedAt: new Date() })
    .where(and(eq(zadarmaExtensions.id, id), eq(zadarmaExtensions.status, "FAILED_NEEDS_MANUAL_CHECK")))
    .returning();
  return row;
}

/** Reassigns an ACTIVE extension to a different agent/company — pure
 * CRM-side bookkeeping. The caller (service layer) is responsible for also
 * updating the real Caller ID via Zadarma's API when the company changes;
 * this function only ever updates our own row. */
export async function reassign(id: string, companyId: string, userId: string, callerIdNumber: string | null): Promise<ZadarmaExtension | undefined> {
  const [row] = await getDb()
    .update(zadarmaExtensions)
    .set({ companyId, userId, callerIdNumber, updatedAt: new Date() })
    .where(and(eq(zadarmaExtensions.id, id), eq(zadarmaExtensions.status, "ACTIVE")))
    .returning();
  return row;
}

/** Restores a REVOKED row to ACTIVE in place — same id, same sipExtension/
 * sipPasswordEncrypted/createdAt/createdBy, nothing about its history
 * touched or deleted. Guarded on `status = 'REVOKED'` in the WHERE clause,
 * same race-closer as claimForRetry above: a double-click, or two
 * Superusers reactivating the same row at once, can only ever have one
 * succeed — the loser gets `undefined` back, never a corrupted state.
 * `callerIdNumber` is always the service layer's freshly re-verified value
 * (confirmed to match the company's current active number before this is
 * ever called) — never the old, possibly-stale stored value. */
export async function reactivate(id: string, callerIdNumber: string): Promise<ZadarmaExtension | undefined> {
  const [row] = await getDb()
    .update(zadarmaExtensions)
    .set({ status: "ACTIVE", callerIdNumber, lastError: null, updatedAt: new Date() })
    .where(and(eq(zadarmaExtensions.id, id), eq(zadarmaExtensions.status, "REVOKED")))
    .returning();
  return row;
}

export async function markRevoked(id: string): Promise<ZadarmaExtension | undefined> {
  const [row] = await getDb()
    .update(zadarmaExtensions)
    .set({ status: "REVOKED", callerIdNumber: null, updatedAt: new Date() })
    .where(and(eq(zadarmaExtensions.id, id), eq(zadarmaExtensions.status, "ACTIVE")))
    .returning();
  return row;
}

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companyRoundRobinCursors } from "@/db/schema";

/** Ensures a cursor row exists for this company, then locks it with
 * SELECT ... FOR UPDATE. Must be called inside the same transaction that
 * will later call setLastAssigned() — the lock is held until that
 * transaction commits, so a concurrent call for the SAME company blocks
 * until this one finishes (different companies never block each other,
 * since each has its own row/lock). */
export async function lockCursor(
  tx: ReturnType<typeof getDb>,
  companyId: string
): Promise<{ lastAssignedUserId: string | null }> {
  await tx.insert(companyRoundRobinCursors).values({ companyId }).onConflictDoNothing();
  const [row] = await tx
    .select({ lastAssignedUserId: companyRoundRobinCursors.lastAssignedUserId })
    .from(companyRoundRobinCursors)
    .where(eq(companyRoundRobinCursors.companyId, companyId))
    .for("update");
  return { lastAssignedUserId: row?.lastAssignedUserId ?? null };
}

export async function setLastAssigned(tx: ReturnType<typeof getDb>, companyId: string, userId: string): Promise<void> {
  await tx
    .update(companyRoundRobinCursors)
    .set({ lastAssignedUserId: userId, updatedAt: new Date() })
    .where(eq(companyRoundRobinCursors.companyId, companyId));
}

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { campaignRoundRobinCursors } from "@/db/schema";

/** Same shape as roundRobinCursors.ts, keyed by campaign instead of company
 * — see campaignRoundRobinCursors' schema comment (src/db/schema.ts) for why
 * campaign-keyed is the right scope for the manager-level "Auto Assign
 * Leads" Round Robin. Ensures a cursor row exists, then locks it with
 * SELECT ... FOR UPDATE. Must be called first thing inside the transaction
 * that will also read "which leads are currently unassigned" and write the
 * new assignments — the lock is what makes two concurrent Auto Assign
 * clicks on the SAME campaign serialize instead of racing onto the same
 * leads (different campaigns never block each other, since each has its
 * own row/lock). */
export async function lockCursor(
  tx: ReturnType<typeof getDb>,
  campaignId: string
): Promise<{ lastAssignedUserId: string | null }> {
  await tx.insert(campaignRoundRobinCursors).values({ campaignId }).onConflictDoNothing();
  const [row] = await tx
    .select({ lastAssignedUserId: campaignRoundRobinCursors.lastAssignedUserId })
    .from(campaignRoundRobinCursors)
    .where(eq(campaignRoundRobinCursors.campaignId, campaignId))
    .for("update");
  return { lastAssignedUserId: row?.lastAssignedUserId ?? null };
}

export async function setLastAssigned(tx: ReturnType<typeof getDb>, campaignId: string, userId: string): Promise<void> {
  await tx
    .update(campaignRoundRobinCursors)
    .set({ lastAssignedUserId: userId, updatedAt: new Date() })
    .where(eq(campaignRoundRobinCursors.campaignId, campaignId));
}

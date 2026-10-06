import * as cursorRepo from "@/server/repositories/campaignRoundRobinCursors";
import { getDb } from "@/db";

/** Pure rotation step for the manager-scoped "Auto Assign Leads" Round
 * Robin: given the already-locked cursor's lastAssignedUserId and the
 * eligible agent pool, returns `count` picks in rotation order and
 * persists the new cursor position.
 *
 * Deliberately does NOT acquire the cursor lock itself — the caller
 * (campaignsService.autoAssignCampaignLeads) must call
 * campaignRoundRobinCursors.lockCursor() first, in the same transaction,
 * BEFORE reading which leads are currently unassigned. That ordering is
 * what makes two concurrent Auto Assign clicks on the same campaign
 * serialize instead of racing onto the same leads; this function only does
 * the math and the final cursor write once that's already guaranteed. */
export async function pickAndAdvance(
  tx: ReturnType<typeof getDb>,
  campaignId: string,
  eligible: { id: string }[],
  lastAssignedUserId: string | null,
  count: number
): Promise<string[]> {
  if (count <= 0 || eligible.length === 0) return [];

  let startIndex = 0;
  if (lastAssignedUserId) {
    const idx = eligible.findIndex((u) => u.id === lastAssignedUserId);
    // idx === -1 means the last-assigned agent is no longer eligible
    // (deactivated, unlinked from this manager, or the campaign was
    // reassigned to a different manager with a different team) — correctly
    // falls through to starting the rotation over from the first currently
    // eligible agent, same self-healing behavior as the company-level cursor.
    startIndex = idx === -1 ? 0 : (idx + 1) % eligible.length;
  }

  const picks: string[] = [];
  for (let i = 0; i < count; i++) picks.push(eligible[(startIndex + i) % eligible.length].id);

  await cursorRepo.setLastAssigned(tx, campaignId, picks[picks.length - 1]);
  return picks;
}

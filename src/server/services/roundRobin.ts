import * as usersRepo from "@/server/repositories/users";
import * as cursorRepo from "@/server/repositories/roundRobinCursors";
import { getDb } from "@/db";

/** Picks the next `count` eligible agents for a company, in rotation order,
 * advancing the persisted per-company cursor exactly once at the end.
 *
 * Must be called inside the same transaction as the contact insert(s) it's
 * assigning. The row lock acquired on the cursor (SELECT ... FOR UPDATE,
 * inside lockCursor) is held until that transaction commits — so two
 * concurrent contact-creation requests for the SAME company serialize on
 * this one row instead of racing onto the same agent; requests for
 * DIFFERENT companies never block each other, since each has its own row.
 *
 * Returns [] (and leaves the cursor untouched) if the company currently has
 * no eligible agents — callers should treat that as "leave unassigned,"
 * never fall back to Superuser or fail the creation. */
export async function pickNextAgents(
  tx: ReturnType<typeof getDb>,
  companyId: string,
  count: number
): Promise<string[]> {
  if (count <= 0) return [];

  const eligible = await usersRepo.findEligibleForRoundRobin(tx, companyId);
  if (eligible.length === 0) {
    console.warn(`Round Robin: company ${companyId} has no eligible agents — contact(s) left unassigned.`);
    return [];
  }

  const cursor = await cursorRepo.lockCursor(tx, companyId);
  let startIndex = 0;
  if (cursor.lastAssignedUserId) {
    const idx = eligible.findIndex((u) => u.id === cursor.lastAssignedUserId);
    // idx === -1 means the last-assigned agent is no longer eligible
    // (deactivated, or lost access) — correctly falls through to starting
    // the rotation over from the first currently-eligible agent.
    startIndex = idx === -1 ? 0 : (idx + 1) % eligible.length;
  }

  const picks: string[] = [];
  for (let i = 0; i < count; i++) picks.push(eligible[(startIndex + i) % eligible.length].id);

  await cursorRepo.setLastAssigned(tx, companyId, picks[picks.length - 1]);
  return picks;
}

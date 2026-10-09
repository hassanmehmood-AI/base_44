import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { managerAgentAssignments } from "@/db/schema";

export type ManagerAgentAssignment = typeof managerAgentAssignments.$inferSelect;

export async function findManagerForAgent(agentUserId: string, companyId: string): Promise<ManagerAgentAssignment | undefined> {
  const [row] = await getDb()
    .select()
    .from(managerAgentAssignments)
    .where(and(eq(managerAgentAssignments.agentUserId, agentUserId), eq(managerAgentAssignments.companyId, companyId)))
    .limit(1);
  return row;
}

export async function findAgentIdsForManager(managerUserId: string, companyId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ agentUserId: managerAgentAssignments.agentUserId })
    .from(managerAgentAssignments)
    .where(and(eq(managerAgentAssignments.managerUserId, managerUserId), eq(managerAgentAssignments.companyId, companyId)));
  return rows.map((r) => r.agentUserId);
}

/** Upserts the (agent, company) -> manager link. Relies on the
 * manager_agent_company_idx unique index so reassigning an agent's manager
 * is a single UPDATE, never a delete+recreate. */
export async function setManagerForAgent(agentUserId: string, companyId: string, managerUserId: string): Promise<void> {
  await getDb()
    .insert(managerAgentAssignments)
    .values({ agentUserId, companyId, managerUserId })
    .onConflictDoUpdate({
      target: [managerAgentAssignments.agentUserId, managerAgentAssignments.companyId],
      set: { managerUserId },
    });
}

export async function removeManagerForAgent(agentUserId: string, companyId: string): Promise<void> {
  await getDb()
    .delete(managerAgentAssignments)
    .where(and(eq(managerAgentAssignments.agentUserId, agentUserId), eq(managerAgentAssignments.companyId, companyId)));
}

/** Every (agent, company) link for this user, across all companies — used
 * when a user stops being a CALL_CENTER_AGENT (role change), since this
 * table's rows only make sense while both ends hold their expected role.
 * Deletes the link only, never the agent's assigned contacts or history. */
export async function removeAllAssignmentsForAgent(agentUserId: string): Promise<void> {
  await getDb().delete(managerAgentAssignments).where(eq(managerAgentAssignments.agentUserId, agentUserId));
}

/** Every (agent, company) link where this user is the manager, across all
 * companies — used when a user stops being a CALL_CENTER_LEAD (role
 * change): unlinks their whole team rather than leaving agents pointed at a
 * manager who no longer holds that role. Deletes the link only, never the
 * agents themselves or their assigned contacts. */
export async function removeAllAssignmentsForManager(managerUserId: string): Promise<void> {
  await getDb().delete(managerAgentAssignments).where(eq(managerAgentAssignments.managerUserId, managerUserId));
}

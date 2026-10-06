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

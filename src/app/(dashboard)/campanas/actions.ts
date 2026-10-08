"use server";

import { revalidatePath } from "next/cache";
import * as campaignsService from "@/server/services/campaigns";
import * as usersService from "@/server/services/users";
import * as contactsService from "@/server/services/contacts";
import { requireSession, UnauthorizedError } from "@/server/services/authorization";
import type { CampaignStatus } from "@/server/constants";

export type ActionResult = { error?: string; ok?: true };

export async function createCampaignAction(input: {
  companyId: string;
  name: string;
  objective: string;
  ownerId: string;
}): Promise<ActionResult> {
  try {
    await campaignsService.createCampaign({
      companyId: input.companyId,
      name: input.name,
      objective: input.objective,
      ownerId: input.ownerId || null,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that company." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/campanas");
  return { ok: true };
}

export async function updateCampaignStatusAction(id: string, status: CampaignStatus): Promise<ActionResult> {
  try {
    await campaignsService.updateCampaignStatus(id, status);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that campaign." };
    throw e;
  }
  revalidatePath("/campanas");
  return { ok: true };
}

/** Options for the campaign "Manager" dropdown — Call Center Managers in
 * this company only (not every assignable user), since a campaign's owner
 * is now that company's assigned manager, not a free-for-all field. */
export async function getCampaignOwnerOptionsAction(companyId: string) {
  try {
    return { users: await usersService.getManagersForCompany(companyId) };
  } catch {
    return { users: [] };
  }
}

export async function reassignCampaignManagerAction(campaignId: string, managerUserId: string): Promise<ActionResult> {
  try {
    await campaignsService.reassignCampaignManager(campaignId, managerUserId || null);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "Only a Superuser or that company's Director can do this." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/campanas");
  return { ok: true };
}

export async function importCampaignMembersAction(
  campaignId: string,
  rows: Array<{ name: string; businessName?: string; phone?: string; email?: string; leadSource?: string }>
): Promise<ActionResult & Partial<Awaited<ReturnType<typeof campaignsService.importCampaignMembers>>>> {
  if (!campaignId) return { error: "Select a campaign first." };
  if (rows.length === 0) return { error: "No valid rows to import." };

  let result: Awaited<ReturnType<typeof campaignsService.importCampaignMembers>>;
  try {
    result = await campaignsService.importCampaignMembers(campaignId, rows);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that campaign." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }

  revalidatePath("/campanas");
  return { ok: true, ...result };
}

export async function getCampaignMembersAction(campaignId: string) {
  try {
    return { members: await campaignsService.getCampaignMembers(campaignId) };
  } catch {
    return { members: [] };
  }
}

/** Options for the per-member "Assign Agent" dropdown — reuses the same
 * CRM-scoped function as the Contacts page (phase 4): a Call Center Manager
 * sees only their own team, everyone else keeps the full company list. */
export async function getAssignableAgentsForCampaignAction(companyId: string) {
  try {
    return { users: await usersService.getAssignableAgentsForCrm(companyId) };
  } catch {
    return { users: [] };
  }
}

/** Manual per-lead assignment on the Campaign Members table — reuses
 * contactsService.assignContact unchanged (same append-only ASSIGNMENT
 * activity, same server-side manager-team guard as the CRM's own Assign
 * Agent action). */
export async function assignCampaignMemberAction(contactId: string, assignedUserId: string): Promise<ActionResult> {
  try {
    await contactsService.assignContact(contactId, assignedUserId || null);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/campanas");
  return { ok: true };
}

export async function getCampaignPageStatsAction() {
  return { stats: await campaignsService.getCampaignPageStats() };
}

/** "My Team" card on the Manage Campaigns page: a Call Center Manager's own
 * agents (manager_agent_assignments), scoped to one company. Deliberately
 * takes no managerUserId from the client -- it's always the caller's own id
 * from the session, so there's no way to pass another manager's id and see
 * their roster. Non-managers always get an empty team (the UI only renders
 * this card for CALL_CENTER_LEAD anyway, but this is the real boundary). */
export async function getMyTeamAction(companyId: string) {
  try {
    const session = await requireSession();
    if (session.user.roleKey !== "CALL_CENTER_LEAD") return { team: [] };
    return { team: await usersService.getManagerTeam(session.user.id, companyId) };
  } catch {
    return { team: [] };
  }
}

export async function autoAssignCampaignLeadsAction(
  campaignId: string
): Promise<ActionResult & { assigned?: number; agentCount?: number; message?: string }> {
  try {
    const result = await campaignsService.autoAssignCampaignLeads(campaignId);
    revalidatePath("/campanas");
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that campaign." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
}

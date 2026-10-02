"use server";

import { revalidatePath } from "next/cache";
import * as campaignsService from "@/server/services/campaigns";
import * as usersService from "@/server/services/users";
import { UnauthorizedError } from "@/server/services/authorization";
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

export async function getCampaignOwnerOptionsAction(companyId: string) {
  try {
    return { users: await usersService.getAssignableUsersForCompany(companyId) };
  } catch {
    return { users: [] };
  }
}

export async function importCampaignMembersAction(
  campaignId: string,
  rows: Array<{ name: string; businessName?: string; phone?: string; email?: string; leadSource?: string }>
): Promise<ActionResult & { created?: number }> {
  if (!campaignId) return { error: "Select a campaign first." };
  if (rows.length === 0) return { error: "No valid rows to import." };

  let created: number;
  try {
    const result = await campaignsService.importCampaignMembers(campaignId, rows);
    created = result.created;
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that campaign." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }

  revalidatePath("/campanas");
  return { ok: true, created };
}

export async function getCampaignMembersAction(campaignId: string) {
  try {
    return { members: await campaignsService.getCampaignMembers(campaignId) };
  } catch {
    return { members: [] };
  }
}

export async function getCampaignPageStatsAction() {
  return { stats: await campaignsService.getCampaignPageStats() };
}

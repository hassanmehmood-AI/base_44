import * as campaignsRepo from "@/server/repositories/campaigns";
import * as campaignContactsRepo from "@/server/repositories/campaignContacts";
import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as pipelineStagesRepo from "@/server/repositories/pipelineStages";
import * as companiesService from "@/server/services/companies";
import * as contactsService from "@/server/services/contacts";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import { OPPORTUNITY_STAGE_KEYS, CUSTOMER_STAGE_KEYS, type Stage } from "@/lib/pipeline";
import type { CampaignStatus } from "@/server/constants";

export async function listCampaignsForCurrentUser() {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  return campaignsRepo.findManyByCompanyIds(allowed.map((c) => c.id));
}

export async function createCampaign(input: { companyId: string; name: string; objective?: string | null; ownerId?: string | null }) {
  await assertCompanyAccess(input.companyId);
  const name = input.name.trim();
  if (!name) throw new Error("Campaign name is required.");

  return campaignsRepo.create({
    companyId: input.companyId,
    name,
    objective: input.objective?.trim() || null,
    ownerId: input.ownerId || null,
  });
}

export async function updateCampaignStatus(id: string, status: CampaignStatus) {
  const companyId = await campaignsRepo.findCompanyIdById(id);
  if (!companyId) throw new UnauthorizedError("Campaign not found.");
  await assertCompanyAccess(companyId);
  return campaignsRepo.updateStatus(id, status);
}

/** Campaigns §17 Option B: imports a CSV of contacts straight into the CRM
 * (reusing contactsService.importContacts, the same flow the CRM page uses)
 * and links the newly created contacts to this campaign via campaign_contacts
 * — deliberately not campaign_members, which belongs to the deferred
 * AI/prospecting pipeline (requires a prospect_lead_id). New contacts land
 * in the pipeline's first stage (NUEVO_LEAD), same as the CRM import. */
export async function importCampaignMembers(
  campaignId: string,
  rows: Array<{ name: string; businessName?: string | null; phone?: string | null; email?: string | null; leadSource?: string | null }>
) {
  const companyId = await campaignsRepo.findCompanyIdById(campaignId);
  if (!companyId) throw new UnauthorizedError("Campaign not found.");
  await assertCompanyAccess(companyId);

  const stages = await pipelineStagesRepo.findDefaultPipelineStages();
  const entryStage = stages[0];
  if (!entryStage) throw new Error("No pipeline stage configured.");

  const { created, contactIds } = await contactsService.importContacts(companyId, entryStage.id, rows);
  await campaignContactsRepo.addMany(campaignId, contactIds);
  return { created };
}

export type CampaignMemberWithChannels = Awaited<ReturnType<typeof campaignContactsRepo.findByCampaignId>>[number] & { channels: string[] };

export async function getCampaignMembers(campaignId: string): Promise<CampaignMemberWithChannels[]> {
  const companyId = await campaignsRepo.findCompanyIdById(campaignId);
  if (!companyId) throw new UnauthorizedError("Campaign not found.");
  await assertCompanyAccess(companyId);

  const members = await campaignContactsRepo.findByCampaignId(campaignId);
  const channelRows = await activitiesRepo.findDistinctChannelsByContactIds(members.map((m) => m.contactId));
  const channelsByContact = new Map<string, string[]>();
  for (const r of channelRows) {
    const list = channelsByContact.get(r.contactId) ?? [];
    list.push(r.channel);
    channelsByContact.set(r.contactId, list);
  }

  return members.map((m) => ({ ...m, channels: channelsByContact.get(m.contactId) ?? [] }));
}

export type CampaignPageStatsByCompany = {
  companyId: string;
  companyName: string;
  totalContacts: number;
  contacted: number;
  customers: number;
  opportunities: number;
};

/** Headline stat cards on the Campaigns page — real aggregates per allowed
 * company (same primitives as the KPIs page: contacts + logged activities +
 * pipeline stage buckets), returned per-company so the client can filter by
 * the top-right company selector the same way every other migrated page
 * does (Kpis/Soporte/Llamadas/Correo/RedesSociales). */
export async function getCampaignPageStats(): Promise<CampaignPageStatsByCompany[]> {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  const companyIds = allowed.map((c) => c.id);

  const contacts = await contactsRepo.findManyByCompanyIds(companyIds);
  const contactedIds = new Set(await activitiesRepo.findContactedContactIds(companyIds));

  const byCompany = new Map<string, Omit<CampaignPageStatsByCompany, "companyId" | "companyName">>();
  for (const c of contacts) {
    const stats = byCompany.get(c.companyId) ?? { totalContacts: 0, contacted: 0, customers: 0, opportunities: 0 };
    stats.totalContacts += 1;
    if (contactedIds.has(c.id)) stats.contacted += 1;
    if (OPPORTUNITY_STAGE_KEYS.includes(c.stageKey as Stage)) stats.opportunities += 1;
    if (CUSTOMER_STAGE_KEYS.includes(c.stageKey as Stage)) stats.customers += 1;
    byCompany.set(c.companyId, stats);
  }

  const companyNameById = new Map(allowed.map((c) => [c.id, c.name]));
  return [...byCompany.entries()].map(([companyId, stats]) => ({
    companyId,
    companyName: companyNameById.get(companyId) ?? "",
    ...stats,
  }));
}

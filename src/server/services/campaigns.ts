import * as campaignsRepo from "@/server/repositories/campaigns";
import * as campaignContactsRepo from "@/server/repositories/campaignContacts";
import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as pipelineStagesRepo from "@/server/repositories/pipelineStages";
import * as usersRepo from "@/server/repositories/users";
import * as accessRepo from "@/server/repositories/access";
import * as campaignRoundRobinCursorsRepo from "@/server/repositories/campaignRoundRobinCursors";
import * as campaignRoundRobinService from "@/server/services/campaignRoundRobin";
import * as companiesService from "@/server/services/companies";
import * as contactsService from "@/server/services/contacts";
import { assertCompanyAccess, assertDirectorOrSuperuser, requireSession, UnauthorizedError } from "@/server/services/authorization";
import { OPPORTUNITY_STAGE_KEYS, CUSTOMER_STAGE_KEYS, type Stage } from "@/lib/pipeline";
import type { CampaignStatus } from "@/server/constants";

/** Validates that managerUserId actually holds CALL_CENTER_LEAD and has
 * access to companyId — shared by createCampaign (initial assignment) and
 * reassignCampaignManager (later reassignment), so a campaign's manager can
 * never be set to a user who isn't actually a manager of that company. */
async function assertValidManager(managerUserId: string, companyId: string) {
  const manager = await usersRepo.findById(managerUserId);
  if (!manager || manager.roleKey !== "CALL_CENTER_LEAD") throw new Error("Campaign manager must be a Call Center Manager.");
  const managerCompanyIds = await accessRepo.findCompanyIdsForUser(managerUserId);
  if (!managerCompanyIds.includes(companyId)) throw new Error("That manager does not have access to this company.");
}

/** Director/Superuser see every campaign in their allowed companies
 * (unchanged). A Call Center Manager only sees campaigns assigned to them
 * (ownerId = them) — campaigns not yet assigned to anyone, or assigned to a
 * different manager, don't appear in their list at all. */
export async function listCampaignsForCurrentUser() {
  const session = await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  const companyIds = allowed.map((c) => c.id);
  if (session.user.roleKey === "CALL_CENTER_LEAD") {
    return campaignsRepo.findManyByCompanyIdsAndOwner(companyIds, session.user.id);
  }
  return campaignsRepo.findManyByCompanyIds(companyIds);
}

export async function createCampaign(input: { companyId: string; name: string; objective?: string | null; ownerId?: string | null }) {
  await assertCompanyAccess(input.companyId);
  const name = input.name.trim();
  if (!name) throw new Error("Campaign name is required.");
  if (input.ownerId) await assertValidManager(input.ownerId, input.companyId);

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

/** Director (own company) / Superuser only — assigns or reassigns which
 * Call Center Manager owns this campaign. Reassigning is a single UPDATE on
 * campaigns.ownerId: it never touches campaign_contacts, contacts, or
 * activities, so historical lead assignments and activity are completely
 * unaffected (matches the spec's "do not automatically reassign existing
 * leads" requirement — this is the ownership pointer only). */
export async function reassignCampaignManager(campaignId: string, managerUserId: string | null) {
  const companyId = await campaignsRepo.findCompanyIdById(campaignId);
  if (!companyId) throw new UnauthorizedError("Campaign not found.");
  await assertDirectorOrSuperuser(companyId);
  if (managerUserId) await assertValidManager(managerUserId, companyId);

  return campaignsRepo.updateOwner(campaignId, managerUserId);
}

export type AutoAssignResult = { assigned: number; agentCount: number; message?: string };

/** "Auto Assign Leads" — manager-scoped, per-campaign Round Robin. Allowed
 * callers: the campaign's own Manager, or Director/Superuser as an explicit
 * override (same authority as reassignCampaignManager). Eligibility is
 * always computed from the CAMPAIGN'S OWNER's team, never the caller's own
 * team — a Director/Superuser triggering this isn't a manager of agents
 * themselves, they're acting on the campaign's assigned manager's behalf.
 *
 * Concurrency: the campaign's Round Robin cursor is locked FIRST, before
 * reading which leads are currently unassigned (see
 * campaignRoundRobinCursors.lockCursor's doc comment) — this is what makes
 * two concurrent Auto Assign clicks on the same campaign serialize instead
 * of racing onto the same leads. Never touches an already-assigned lead:
 * the "unassigned" read is a hard `assignedUserId IS NULL` filter, not a
 * best-effort check. If there are no unassigned leads, or the manager has
 * no active agents, returns a zero-result with a clear `message` instead of
 * throwing — this is an expected outcome, not an error. */
export async function autoAssignCampaignLeads(campaignId: string): Promise<AutoAssignResult> {
  const session = await requireSession();
  const companyId = await campaignsRepo.findCompanyIdById(campaignId);
  if (!companyId) throw new UnauthorizedError("Campaign not found.");

  if (!["SUPERUSER", "DIRECTOR", "CALL_CENTER_LEAD"].includes(session.user.roleKey)) {
    throw new UnauthorizedError("Only a Manager, Director, or Superuser can auto-assign campaign leads.");
  }
  await assertCompanyAccess(companyId);

  const ownerId = await campaignsRepo.findOwnerIdById(campaignId);
  if (session.user.roleKey === "CALL_CENTER_LEAD" && ownerId !== session.user.id) {
    throw new UnauthorizedError("You don't manage this campaign.");
  }
  if (!ownerId) {
    return { assigned: 0, agentCount: 0, message: "This campaign has no manager assigned yet — assign one before auto-assigning leads." };
  }

  return contactsRepo.withTransaction(async (tx) => {
    const cursor = await campaignRoundRobinCursorsRepo.lockCursor(tx, campaignId);

    const unassignedContactIds = await campaignContactsRepo.findUnassignedContactIdsInTx(tx, campaignId);
    if (unassignedContactIds.length === 0) {
      return { assigned: 0, agentCount: 0, message: "No unassigned leads in this campaign." };
    }

    const eligible = await usersRepo.findEligibleForManagerRoundRobin(tx, companyId, ownerId);
    if (eligible.length === 0) {
      return { assigned: 0, agentCount: 0, message: "This campaign's manager has no active agents to assign to." };
    }

    const picks = await campaignRoundRobinService.pickAndAdvance(
      tx,
      campaignId,
      eligible,
      cursor.lastAssignedUserId,
      unassignedContactIds.length
    );

    for (let i = 0; i < unassignedContactIds.length; i++) {
      await contactsRepo.updateInTx(tx, unassignedContactIds[i], { assignedUserId: picks[i] });
    }

    const uniqueAgentIds = [...new Set(picks)];
    const agents = await Promise.all(uniqueAgentIds.map((id) => usersRepo.findById(id)));
    const nameById = new Map(uniqueAgentIds.map((id, i) => [id, agents[i]?.fullName ?? "Unknown"]));

    await activitiesRepo.createMany(
      tx,
      unassignedContactIds.map((contactId, i) => ({
        companyId,
        contactId,
        type: "AUTO_ASSIGNMENT",
        channel: null,
        outcome: nameById.get(picks[i]) ?? "Unknown",
        notes: null,
        createdBy: session.user.id,
      }))
    );

    return { assigned: unassignedContactIds.length, agentCount: uniqueAgentIds.length };
  });
}

/** Campaigns §17 Option B: imports a CSV of contacts straight into the CRM
 * (reusing contactsService.importContacts, the same flow the CRM page uses)
 * and links the newly created contacts to this campaign via campaign_contacts
 * — deliberately not campaign_members, which belongs to the deferred
 * AI/prospecting pipeline (requires a prospect_lead_id). New contacts land
 * in the pipeline's first stage (NUEVO_LEAD), same as the CRM import.
 *
 * skipRoundRobin: true — campaign leads must land Unassigned, never grabbed
 * by the company-level Round Robin meant for manual/standalone CRM leads.
 * The campaign's manager distributes these via manual Assign Agent or the
 * manager-scoped "Auto Assign Leads" Round Robin instead. */
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

  const { created, contactIds } = await contactsService.importContacts(companyId, entryStage.id, rows, {
    skipRoundRobin: true,
  });
  await campaignContactsRepo.addMany(campaignId, contactIds);
  return { created };
}

/** CRM page's "Campaign" filter: contacts linked to this campaign, in the
 * same ContactWithJoins shape the CRM page already renders everywhere else
 * (unlike getCampaignMembers() below, which returns the Campaigns-page-
 * specific member/channels shape). Authorizes against the campaign's
 * company before touching any contact data — never trusts the client.
 * Phase 4: a Call Center Manager may only use this filter on a campaign
 * they actually own (defense-in-depth — the UI's campaign dropdown is
 * already scoped by listCampaignsForCurrentUser, but this blocks direct
 * action calls with another manager's campaign id too); a Call Center Agent
 * sees only their own contacts within the campaign. */
export async function listContactsForCrm(campaignId: string) {
  const session = await requireSession();
  const companyId = await campaignsRepo.findCompanyIdById(campaignId);
  if (!companyId) throw new UnauthorizedError("Campaign not found.");
  await assertCompanyAccess(companyId);

  if (session.user.roleKey === "CALL_CENTER_LEAD") {
    const ownerId = await campaignsRepo.findOwnerIdById(campaignId);
    if (ownerId !== session.user.id) throw new UnauthorizedError("You don't manage this campaign.");
    return contactsRepo.findManyByCampaignId(campaignId);
  }
  if (session.user.roleKey === "CALL_CENTER_AGENT") {
    return contactsRepo.findManyByCampaignIdAndAssignedUser(campaignId, session.user.id);
  }
  return contactsRepo.findManyByCampaignId(campaignId);
}

export type CampaignMemberWithChannels = Awaited<ReturnType<typeof campaignContactsRepo.findByCampaignId>>[number] & { channels: string[] };

/** Manage Campaigns page's member table. Phase 4: a Call Center Manager may
 * only view members of a campaign they own — same defense-in-depth
 * rationale as listContactsForCrm above (satisfies "Manager 2 cannot access
 * Campaign 1 through direct request manipulation"). Director/Superuser
 * unchanged. */
export async function getCampaignMembers(campaignId: string): Promise<CampaignMemberWithChannels[]> {
  const session = await requireSession();
  const companyId = await campaignsRepo.findCompanyIdById(campaignId);
  if (!companyId) throw new UnauthorizedError("Campaign not found.");
  await assertCompanyAccess(companyId);

  if (session.user.roleKey === "CALL_CENTER_LEAD") {
    const ownerId = await campaignsRepo.findOwnerIdById(campaignId);
    if (ownerId !== session.user.id) throw new UnauthorizedError("You don't manage this campaign.");
  }

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

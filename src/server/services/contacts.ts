import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as companiesRepo from "@/server/repositories/companies";
import * as pipelineStagesRepo from "@/server/repositories/pipelineStages";
import * as usersRepo from "@/server/repositories/users";
import * as roundRobinService from "@/server/services/roundRobin";
import { assertCompanyAccess, requireSession } from "@/server/services/authorization";
import { UnauthorizedError } from "@/server/services/authorization";

async function getAllowedCompanyIds(session: Awaited<ReturnType<typeof requireSession>>) {
  if (session.user.roleKey === "SUPERUSER") {
    const all = await companiesRepo.findAllActive();
    return all.map((c) => c.id);
  }
  return session.user.companyIds;
}

export async function listContactsForCurrentUser() {
  const session = await requireSession();
  const companyIds = await getAllowedCompanyIds(session);
  return contactsRepo.findManyByCompanyIds(companyIds);
}

/** CRM page's "Manual Leads" filter: contacts never linked to any campaign,
 * scoped to the same allowed-company rule as the default "All Contacts" view. */
export async function listManualContactsForCurrentUser() {
  const session = await requireSession();
  const companyIds = await getAllowedCompanyIds(session);
  return contactsRepo.findManualByCompanyIds(companyIds);
}

export async function getContact(id: string) {
  const contact = await contactsRepo.findById(id);
  if (!contact) return undefined;
  await assertCompanyAccess(contact.companyId);
  const recentActivities = await activitiesRepo.findRecentByContactId(id);
  return { contact, activities: recentActivities };
}

/** Creates a contact. When the caller doesn't specify an owner at all
 * (assignedUserId left undefined — the CRM "New Contact" form never passes
 * one), the contact is automatically assigned via company Round Robin and
 * an AUTO_ASSIGNMENT activity is logged, atomically with the insert. If the
 * caller explicitly passes assignedUserId (including null), that's
 * respected as-is and Round Robin is skipped. */
export async function createContact(input: {
  companyId: string;
  name: string;
  businessName?: string | null;
  phone?: string | null;
  email?: string | null;
  leadSource?: string | null;
  pipelineStageId: string;
  assignedUserId?: string | null;
}) {
  const session = await assertCompanyAccess(input.companyId);

  return contactsRepo.withTransaction(async (tx) => {
    let assignedUserId = input.assignedUserId ?? null;
    let autoAssignedName: string | null = null;

    if (input.assignedUserId === undefined) {
      const [picked] = await roundRobinService.pickNextAgents(tx, input.companyId, 1);
      if (picked) {
        assignedUserId = picked;
        autoAssignedName = (await usersRepo.findById(picked))?.fullName ?? null;
      }
    }

    const contact = await contactsRepo.create(
      {
        companyId: input.companyId,
        name: input.name,
        businessName: input.businessName,
        phone: input.phone,
        email: input.email,
        leadSource: input.leadSource,
        pipelineStageId: input.pipelineStageId,
        assignedUserId,
      },
      tx
    );

    if (assignedUserId && autoAssignedName) {
      await activitiesRepo.create(tx, {
        companyId: input.companyId,
        contactId: contact.id,
        type: "AUTO_ASSIGNMENT",
        channel: null,
        outcome: autoAssignedName,
        notes: null,
        createdBy: session.user.id,
      });
    }

    return contact;
  });
}

const MAX_IMPORT_ROWS = 500;

/** CSV/Excel import (CRM "Import Excel/CSV"): the client already parsed and
 * previewed the file, so this only re-validates (never trust client input)
 * and bulk-inserts. Every row lands in the same company/stage — one row's
 * bad data doesn't block the rest, since invalid rows are filtered out
 * before this is called (see CrmClient's import preview step). */
/** Bulk create — used by both the CRM's own "Import Excel/CSV" (Round Robin
 * applies, same as a single manual contact) and, with `skipRoundRobin: true`,
 * by campaignsService.importCampaignMembers() for the Manage Campaigns CSV
 * import: campaign leads must land Unassigned so the campaign's manager can
 * distribute them manually or via the manager-scoped "Auto Assign Leads"
 * Round Robin, never the company-level one. When Round Robin does apply,
 * every newly created row gets it (same per-company cursor as createContact —
 * one lock acquisition for the whole batch, so a 20-row import distributes
 * fairly across agents in one atomic pass, not 20 separate races). */
export async function importContacts(
  companyId: string,
  pipelineStageId: string,
  rows: Array<{
    name: string;
    businessName?: string | null;
    phone?: string | null;
    email?: string | null;
    leadSource?: string | null;
  }>,
  options?: { skipRoundRobin?: boolean }
) {
  const session = await assertCompanyAccess(companyId);
  if (rows.length === 0) return { created: 0, contactIds: [] };
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Can't import more than ${MAX_IMPORT_ROWS} contacts at once.`);

  const validRows = rows.filter((r) => r.name.trim().length > 0);
  if (validRows.length === 0) return { created: 0, contactIds: [] };

  return contactsRepo.withTransaction(async (tx) => {
    const assignments = options?.skipRoundRobin
      ? []
      : await roundRobinService.pickNextAgents(tx, companyId, validRows.length);

    const created = await contactsRepo.createMany(
      validRows.map((r, i) => ({
        companyId,
        pipelineStageId,
        name: r.name.trim(),
        businessName: r.businessName?.trim() || null,
        phone: r.phone?.trim() || null,
        email: r.email?.trim() || null,
        leadSource: r.leadSource?.trim() || null,
        assignedUserId: assignments[i] ?? null,
      })),
      tx
    );

    if (assignments.length > 0) {
      const uniqueAgentIds = [...new Set(assignments)];
      const agents = await Promise.all(uniqueAgentIds.map((id) => usersRepo.findById(id)));
      const nameById = new Map(uniqueAgentIds.map((id, i) => [id, agents[i]?.fullName ?? "Unknown"]));

      await activitiesRepo.createMany(
        tx,
        created.map((c, i) => ({
          companyId,
          contactId: c.id,
          type: "AUTO_ASSIGNMENT",
          channel: null,
          outcome: nameById.get(assignments[i]) ?? "Unknown",
          notes: null,
          createdBy: session.user.id,
        }))
      );
    }

    return { created: created.length, contactIds: created.map((c) => c.id) };
  });
}

export async function updateContactCore(
  id: string,
  input: {
    name: string;
    businessName?: string | null;
    phone?: string | null;
    email?: string | null;
    leadSource?: string | null;
  }
) {
  const companyId = await contactsRepo.findCompanyIdById(id);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);
  return contactsRepo.update(id, input);
}

/** The CRM page's "Classify contact" panel: updates the contact's pipeline
 * position/ownership/next action AND appends the corresponding Activity, in
 * one transaction — matches guide §11's "update Contact + append Activity"
 * flow. Never partially applies: either both happen or neither does. */
export async function classifyContact(
  id: string,
  input: {
    pipelineStageId: string;
    assignedUserId: string | null;
    nextAction: string | null;
    followUpAt: Date | null;
    activityType: string;
    activityChannel: string;
    outcome: string;
    notes: string | null;
  }
) {
  const session = await requireSession();
  const companyId = await contactsRepo.findCompanyIdById(id);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);

  return contactsRepo.withTransaction(async (tx) => {
    const now = new Date();
    const contact = await contactsRepo.updateInTx(tx, id, {
      pipelineStageId: input.pipelineStageId,
      assignedUserId: input.assignedUserId,
      nextAction: input.nextAction,
      followUpAt: input.followUpAt,
      lastContactAt: now,
    });
    const activity = await activitiesRepo.create(tx, {
      companyId,
      contactId: id,
      type: input.activityType,
      channel: input.activityChannel,
      outcome: input.outcome,
      notes: input.notes,
      createdBy: session.user.id,
    });
    return { contact, activity };
  });
}

/** Kanban board's "move card to another column" action: changes only the
 * contact's stage and logs a STATUS_CHANGE activity — lighter than
 * classifyContact() which also captures channel/notes/next-action for a
 * full logged interaction. */
export async function moveContactStage(id: string, pipelineStageId: string) {
  const session = await requireSession();
  const companyId = await contactsRepo.findCompanyIdById(id);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);

  const stage = await pipelineStagesRepo.findById(pipelineStageId);
  if (!stage) throw new Error("Stage not found.");

  return contactsRepo.withTransaction(async (tx) => {
    const contact = await contactsRepo.updateInTx(tx, id, { pipelineStageId });
    const activity = await activitiesRepo.create(tx, {
      companyId,
      contactId: id,
      type: "STATUS_CHANGE",
      channel: null,
      outcome: stage.key,
      notes: null,
      createdBy: session.user.id,
    });
    return { contact, activity };
  });
}

/** Quick standalone "reassign this contact" action — lighter than
 * classifyContact() for when you just want to change the owner without
 * logging a full interaction (channel/stage/notes). */
export async function assignContact(id: string, assignedUserId: string | null) {
  const session = await requireSession();
  const companyId = await contactsRepo.findCompanyIdById(id);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);

  const agentName = assignedUserId ? (await usersRepo.findById(assignedUserId))?.fullName ?? null : null;

  return contactsRepo.withTransaction(async (tx) => {
    const contact = await contactsRepo.updateInTx(tx, id, { assignedUserId });
    const activity = await activitiesRepo.create(tx, {
      companyId,
      contactId: id,
      type: "ASSIGNMENT",
      channel: null,
      outcome: agentName ?? "Unassigned",
      notes: null,
      createdBy: session.user.id,
    });
    return { contact, activity };
  });
}

/** Lightweight companion to classifyContact() for the common case of "just log
 * a note" — updates lastContactAt and appends a NOTE activity, but leaves
 * stage/owner/next-action untouched. Still one transaction, same guarantee:
 * either both happen or neither does. */
export async function addNote(id: string, notes: string) {
  const session = await requireSession();
  const companyId = await contactsRepo.findCompanyIdById(id);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);

  return contactsRepo.withTransaction(async (tx) => {
    const contact = await contactsRepo.updateInTx(tx, id, { lastContactAt: new Date() });
    const activity = await activitiesRepo.create(tx, {
      companyId,
      contactId: id,
      type: "NOTE",
      channel: null,
      outcome: null,
      notes,
      createdBy: session.user.id,
    });
    return { contact, activity };
  });
}

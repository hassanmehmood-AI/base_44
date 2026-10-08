import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as companiesRepo from "@/server/repositories/companies";
import * as pipelineStagesRepo from "@/server/repositories/pipelineStages";
import * as usersRepo from "@/server/repositories/users";
import * as managerAgentRepo from "@/server/repositories/managerAgentAssignments";
import * as roundRobinService from "@/server/services/roundRobin";
import { assertCompanyAccess, requireSession } from "@/server/services/authorization";
import { UnauthorizedError } from "@/server/services/authorization";

/** Shared by every write path that can set contacts.assignedUserId
 * (assignContact, classifyContact): a Call Center Manager may only assign to
 * a user on their own team (manager_agent_assignments). Without this, a
 * manager could bypass the UI's already-scoped options via a direct action
 * call with a tampered assignedUserId — this is what actually makes
 * "Manager 1 cannot assign to Manager 2's agents" true server-side, not just
 * hidden in the dropdown. */
async function assertManagerCanAssign(
  session: Awaited<ReturnType<typeof requireSession>>,
  assignedUserId: string | null,
  companyId: string
) {
  if (session.user.roleKey !== "CALL_CENTER_LEAD" || !assignedUserId) return;
  const link = await managerAgentRepo.findManagerForAgent(assignedUserId, companyId);
  if (link?.managerUserId !== session.user.id) {
    throw new UnauthorizedError("You can only assign leads to agents on your own team.");
  }
}

async function getAllowedCompanyIds(session: Awaited<ReturnType<typeof requireSession>>) {
  if (session.user.roleKey === "SUPERUSER") {
    const all = await companiesRepo.findAllActive();
    return all.map((c) => c.id);
  }
  return session.user.companyIds;
}

/** CRM page's default "All Contacts" view. Hierarchy redesign phase 4:
 * Director/Superuser/Marketing see every contact in their allowed companies
 * (unchanged). A Call Center Agent sees only contacts assigned to them. A
 * Call Center Manager sees only contacts tied to campaigns they own, plus
 * contacts assigned to their own agents (see findManyByManagerScope). This
 * is an intentional, real tightening versus the previous "anyone with
 * company access sees every company contact" behavior — confirmed with the
 * product owner knowing it means an Agent/Manager with nothing assigned yet
 * will see an empty list until leads are assigned or campaigns are owned. */
export async function listContactsForCurrentUser() {
  const session = await requireSession();
  const companyIds = await getAllowedCompanyIds(session);
  if (session.user.roleKey === "CALL_CENTER_AGENT") {
    return contactsRepo.findManyByAssignedUserId(companyIds, session.user.id);
  }
  if (session.user.roleKey === "CALL_CENTER_LEAD") {
    return contactsRepo.findManyByManagerScope(companyIds, session.user.id);
  }
  return contactsRepo.findManyByCompanyIds(companyIds);
}

/** CRM page's "Manual Leads" filter: contacts never linked to any campaign,
 * scoped to the same allowed-company rule as the default "All Contacts" view,
 * with the same phase 4 Agent/Manager narrowing applied. */
export async function listManualContactsForCurrentUser() {
  const session = await requireSession();
  const companyIds = await getAllowedCompanyIds(session);
  if (session.user.roleKey === "CALL_CENTER_AGENT") {
    return contactsRepo.findManualByAssignedUserId(companyIds, session.user.id);
  }
  if (session.user.roleKey === "CALL_CENTER_LEAD") {
    return contactsRepo.findManualByManagerScope(companyIds, session.user.id);
  }
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

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

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
export type ImportContactsResult = {
  totalRows: number;
  created: number;
  duplicatesInFile: number;
  duplicatesExisting: number;
  contactIds: string[];
};

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
): Promise<ImportContactsResult> {
  const session = await assertCompanyAccess(companyId);
  const totalRows = rows.length;
  const empty = { totalRows, created: 0, duplicatesInFile: 0, duplicatesExisting: 0, contactIds: [] };
  if (rows.length === 0) return empty;
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Can't import more than ${MAX_IMPORT_ROWS} contacts at once.`);

  // Client already re-validates/previews before calling this (never trust
  // client input), so this is a defensive re-check, not the primary filter.
  const validRows = rows.filter((r) => r.name.trim().length > 0);
  if (validRows.length === 0) return empty;

  // Duplicate check, scoped to this company only (never compared across
  // companies — a shared email/phone in a different company is not a
  // duplicate under current business rules): first collapse repeats within
  // the file itself, then drop anything matching a contact that already
  // exists here. Matching is by normalized email OR phone; a row with
  // neither never matches anything, since there's nothing reliable to
  // compare. Existing contacts are only ever skipped, never overwritten.
  const existing = await contactsRepo.findEmailsAndPhonesByCompanyId(companyId);
  const existingEmails = new Set(existing.map((c) => normalizeEmail(c.email)).filter((v): v is string => v !== null));
  const existingPhones = new Set(existing.map((c) => normalizePhone(c.phone)).filter((v): v is string => v !== null));

  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  let duplicatesInFile = 0;
  let duplicatesExisting = 0;
  const dedupedRows: typeof validRows = [];

  for (const r of validRows) {
    const email = normalizeEmail(r.email);
    const phone = normalizePhone(r.phone);

    if (email || phone) {
      const inFile = (email !== null && seenEmails.has(email)) || (phone !== null && seenPhones.has(phone));
      if (inFile) {
        duplicatesInFile++;
        continue;
      }
      const inDb = (email !== null && existingEmails.has(email)) || (phone !== null && existingPhones.has(phone));
      if (inDb) {
        duplicatesExisting++;
        continue;
      }
      if (email) seenEmails.add(email);
      if (phone) seenPhones.add(phone);
    }
    dedupedRows.push(r);
  }

  if (dedupedRows.length === 0) {
    return { totalRows, created: 0, duplicatesInFile, duplicatesExisting, contactIds: [] };
  }

  return contactsRepo.withTransaction(async (tx) => {
    const assignments = options?.skipRoundRobin
      ? []
      : await roundRobinService.pickNextAgents(tx, companyId, dedupedRows.length);

    const created = await contactsRepo.createMany(
      dedupedRows.map((r, i) => ({
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

    return {
      totalRows,
      created: created.length,
      duplicatesInFile,
      duplicatesExisting,
      contactIds: created.map((c) => c.id),
    };
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
  await assertManagerCanAssign(session, input.assignedUserId, companyId);

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
  await assertManagerCanAssign(session, assignedUserId, companyId);

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

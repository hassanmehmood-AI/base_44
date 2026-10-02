import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as companiesRepo from "@/server/repositories/companies";
import * as pipelineStagesRepo from "@/server/repositories/pipelineStages";
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

export async function getContact(id: string) {
  const contact = await contactsRepo.findById(id);
  if (!contact) return undefined;
  await assertCompanyAccess(contact.companyId);
  const recentActivities = await activitiesRepo.findRecentByContactId(id);
  return { contact, activities: recentActivities };
}

export async function createContact(input: {
  companyId: string;
  name: string;
  businessName?: string | null;
  phone?: string | null;
  email?: string | null;
  leadSource?: string | null;
  pipelineStageId: string;
}) {
  await assertCompanyAccess(input.companyId);
  return contactsRepo.create(input);
}

const MAX_IMPORT_ROWS = 500;

/** CSV/Excel import (CRM "Import Excel/CSV"): the client already parsed and
 * previewed the file, so this only re-validates (never trust client input)
 * and bulk-inserts. Every row lands in the same company/stage — one row's
 * bad data doesn't block the rest, since invalid rows are filtered out
 * before this is called (see CrmClient's import preview step). */
export async function importContacts(
  companyId: string,
  pipelineStageId: string,
  rows: Array<{
    name: string;
    businessName?: string | null;
    phone?: string | null;
    email?: string | null;
    leadSource?: string | null;
  }>
) {
  await assertCompanyAccess(companyId);
  if (rows.length === 0) return { created: 0, contactIds: [] };
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Can't import more than ${MAX_IMPORT_ROWS} contacts at once.`);

  const validRows = rows.filter((r) => r.name.trim().length > 0);
  const created = await contactsRepo.createMany(
    validRows.map((r) => ({
      companyId,
      pipelineStageId,
      name: r.name.trim(),
      businessName: r.businessName?.trim() || null,
      phone: r.phone?.trim() || null,
      email: r.email?.trim() || null,
      leadSource: r.leadSource?.trim() || null,
    }))
  );
  return { created: created.length, contactIds: created.map((c) => c.id) };
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

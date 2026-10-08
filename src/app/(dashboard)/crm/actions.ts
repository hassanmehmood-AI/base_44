"use server";

import { revalidatePath } from "next/cache";
import * as contactsService from "@/server/services/contacts";
import * as usersService from "@/server/services/users";
import * as tasksService from "@/server/services/tasks";
import * as campaignsService from "@/server/services/campaigns";
import { UnauthorizedError, requireSession } from "@/server/services/authorization";
import type { ActivityWithAuthor } from "@/server/repositories/activities";
import type { TaskWithAssignee } from "@/server/repositories/tasks";

export type ActionResult = { error?: string; ok?: true };

export async function getContactActivitiesAction(contactId: string) {
  const result = await contactsService.getContact(contactId);
  return { activities: result?.activities ?? [] };
}

export async function getContactsForCampaignAction(campaignId: string) {
  try {
    return { contacts: await campaignsService.listContactsForCrm(campaignId) };
  } catch {
    return { contacts: [] };
  }
}

export async function getManualContactsAction() {
  try {
    return { contacts: await contactsService.listManualContactsForCurrentUser() };
  } catch {
    return { contacts: [] };
  }
}

export async function getAssignableUsersAction(companyId: string) {
  try {
    return { users: await usersService.getAssignableAgentsForCrm(companyId) };
  } catch {
    return { users: [] };
  }
}

export async function getContactTasksAction(contactId: string) {
  try {
    return { tasks: await tasksService.listOpenTasksForContact(contactId) };
  } catch {
    return { tasks: [] };
  }
}

export async function createTaskAction(input: {
  contactId: string;
  title: string;
  assignedUserId: string;
  priority: string;
  dueAt: string;
}): Promise<ActionResult & { task?: TaskWithAssignee }> {
  if (!input.title.trim()) return { error: "Title is required." };

  let task: TaskWithAssignee;
  try {
    task = await tasksService.createTask({
      contactId: input.contactId,
      title: input.title.trim(),
      assignedUserId: input.assignedUserId || null,
      priority: input.priority || null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    throw e;
  }

  revalidatePath("/crm");
  return { ok: true, task };
}

export async function completeTaskAction(taskId: string): Promise<ActionResult> {
  try {
    await tasksService.completeTask(taskId);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that task." };
    throw e;
  }

  revalidatePath("/crm");
  return { ok: true };
}

export async function createContactAction(input: {
  companyId: string;
  name: string;
  businessName: string;
  phone: string;
  email: string;
  leadSource: string;
  pipelineStageId: string;
}): Promise<ActionResult> {
  if (!input.name.trim()) return { error: "Name is required." };
  if (!input.companyId) return { error: "Company is required." };
  if (!input.pipelineStageId) return { error: "Stage is required." };

  try {
    await contactsService.createContact({
      companyId: input.companyId,
      name: input.name.trim(),
      businessName: input.businessName.trim() || null,
      phone: input.phone.trim() || null,
      email: input.email.trim() || null,
      leadSource: input.leadSource.trim() || null,
      pipelineStageId: input.pipelineStageId,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that company." };
    throw e;
  }

  revalidatePath("/crm");
  return { ok: true };
}

export async function updateContactAction(
  id: string,
  input: { name: string; businessName: string; phone: string; email: string; leadSource: string }
): Promise<ActionResult> {
  if (!input.name.trim()) return { error: "Name is required." };

  try {
    await contactsService.updateContactCore(id, {
      name: input.name.trim(),
      businessName: input.businessName.trim() || null,
      phone: input.phone.trim() || null,
      email: input.email.trim() || null,
      leadSource: input.leadSource.trim() || null,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    throw e;
  }

  revalidatePath("/crm");
  return { ok: true };
}

export async function classifyContactAction(
  id: string,
  input: {
    pipelineStageId: string;
    assignedUserId: string;
    nextAction: string;
    followUpAt: string;
    activityType: string;
    activityChannel: string;
    outcome: string;
    notes: string;
  }
): Promise<ActionResult & { activity?: ActivityWithAuthor }> {
  if (!input.pipelineStageId) return { error: "Stage is required." };

  let activity;
  try {
    const session = await requireSession();
    const result = await contactsService.classifyContact(id, {
      pipelineStageId: input.pipelineStageId,
      assignedUserId: input.assignedUserId || null,
      nextAction: input.nextAction.trim() || null,
      followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
      activityType: input.activityType,
      activityChannel: input.activityChannel,
      outcome: input.outcome,
      notes: input.notes.trim() || null,
    });
    activity = { ...result.activity, authorName: session.user.name };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    throw e;
  }

  revalidatePath("/crm");
  return { ok: true, activity };
}

export async function assignContactAction(
  contactId: string,
  assignedUserId: string
): Promise<ActionResult & { activity?: ActivityWithAuthor }> {
  let activity;
  try {
    const session = await requireSession();
    const result = await contactsService.assignContact(contactId, assignedUserId || null);
    activity = { ...result.activity, authorName: session.user.name };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    throw e;
  }

  revalidatePath("/crm");
  return { ok: true, activity };
}

export async function moveContactStageAction(
  contactId: string,
  pipelineStageId: string
): Promise<ActionResult & { activity?: ActivityWithAuthor }> {
  if (!pipelineStageId) return { error: "Stage is required." };

  let activity;
  try {
    const session = await requireSession();
    const result = await contactsService.moveContactStage(contactId, pipelineStageId);
    activity = { ...result.activity, authorName: session.user.name };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    throw e;
  }

  revalidatePath("/crm");
  return { ok: true, activity };
}

export async function importContactsAction(
  companyId: string,
  pipelineStageId: string,
  rows: Array<{ name: string; businessName?: string; phone?: string; email?: string; leadSource?: string }>
): Promise<ActionResult & Partial<contactsService.ImportContactsResult>> {
  if (!companyId) return { error: "Company is required." };
  if (!pipelineStageId) return { error: "No pipeline stage configured." };
  if (rows.length === 0) return { error: "No valid rows to import." };

  let result: contactsService.ImportContactsResult;
  try {
    result = await contactsService.importContacts(companyId, pipelineStageId, rows);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that company." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }

  revalidatePath("/crm");
  return { ok: true, ...result };
}

export async function addNoteAction(contactId: string, notes: string): Promise<ActionResult & { activity?: ActivityWithAuthor }> {
  const trimmed = notes.trim();
  if (!trimmed) return { error: "Note can't be empty." };

  let activity;
  try {
    const session = await requireSession();
    const result = await contactsService.addNote(contactId, trimmed);
    activity = { ...result.activity, authorName: session.user.name };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    throw e;
  }

  revalidatePath("/crm");
  return { ok: true, activity };
}

import * as tasksRepo from "@/server/repositories/tasks";
import * as contactsRepo from "@/server/repositories/contacts";
import { assertCompanyAccess, requireSession } from "@/server/services/authorization";
import { UnauthorizedError } from "@/server/services/authorization";

export async function listOpenTasksForContact(contactId: string) {
  const companyId = await contactsRepo.findCompanyIdById(contactId);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);
  return tasksRepo.findOpenByContactId(contactId);
}

export async function createTask(input: {
  contactId: string;
  title: string;
  assignedUserId: string | null;
  priority: string | null;
  dueAt: Date | null;
}) {
  const session = await requireSession();
  const companyId = await contactsRepo.findCompanyIdById(input.contactId);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);

  const created = await tasksRepo.create({
    companyId,
    contactId: input.contactId,
    title: input.title,
    assignedUserId: input.assignedUserId,
    priority: input.priority,
    dueAt: input.dueAt,
    createdBy: session.user.id,
  });
  return (await tasksRepo.findById(created.id))!;
}

export async function completeTask(id: string) {
  const companyId = await tasksRepo.findCompanyIdById(id);
  if (!companyId) throw new UnauthorizedError("Task not found.");
  await assertCompanyAccess(companyId);
  return tasksRepo.complete(id);
}

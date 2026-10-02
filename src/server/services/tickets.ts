import * as ticketsRepo from "@/server/repositories/tickets";
import * as ticketMessagesRepo from "@/server/repositories/ticketMessages";
import * as companiesService from "@/server/services/companies";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import type { TicketStatus, TicketPriority } from "@/server/constants";

export async function listTicketsForCurrentUser() {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  return ticketsRepo.findManyByCompanyIds(allowed.map((c) => c.id));
}

export async function getTicket(id: string) {
  const ticket = await ticketsRepo.findById(id);
  if (!ticket) return undefined;
  await assertCompanyAccess(ticket.companyId);
  const messages = await ticketMessagesRepo.findByTicketId(id);
  return { ticket, messages };
}

export async function createTicket(input: {
  companyId: string;
  subject: string;
  description?: string | null;
  priority: TicketPriority;
}) {
  const session = await requireSession();
  await assertCompanyAccess(input.companyId);
  const subject = input.subject.trim();
  if (!subject) throw new Error("Ticket subject is required.");

  const created = await ticketsRepo.create({
    companyId: input.companyId,
    subject,
    description: input.description?.trim() || null,
    priority: input.priority,
    createdBy: session.user.id,
  });
  return (await ticketsRepo.findById(created.id))!;
}

export async function updateTicketStatus(id: string, status: TicketStatus) {
  const companyId = await ticketsRepo.findCompanyIdById(id);
  if (!companyId) throw new UnauthorizedError("Ticket not found.");
  await assertCompanyAccess(companyId);
  return ticketsRepo.updateStatus(id, status);
}

export async function updateTicketAssignee(id: string, assigneeId: string | null) {
  const companyId = await ticketsRepo.findCompanyIdById(id);
  if (!companyId) throw new UnauthorizedError("Ticket not found.");
  await assertCompanyAccess(companyId);
  return ticketsRepo.updateAssignee(id, assigneeId);
}

export async function addTicketMessage(id: string, body: string) {
  const session = await requireSession();
  const companyId = await ticketsRepo.findCompanyIdById(id);
  if (!companyId) throw new UnauthorizedError("Ticket not found.");
  await assertCompanyAccess(companyId);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message cannot be empty.");

  return ticketMessagesRepo.create({
    ticketId: id,
    authorId: session.user.id,
    body: trimmed,
  });
}

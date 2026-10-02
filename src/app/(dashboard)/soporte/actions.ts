"use server";

import { revalidatePath } from "next/cache";
import * as ticketsService from "@/server/services/tickets";
import * as usersService from "@/server/services/users";
import { UnauthorizedError } from "@/server/services/authorization";
import type { TicketStatus, TicketPriority } from "@/server/constants";

export type ActionResult = { error?: string; ok?: true };

export async function createTicketAction(input: {
  companyId: string;
  subject: string;
  description: string;
  priority: TicketPriority;
}): Promise<ActionResult & { id?: string }> {
  try {
    const ticket = await ticketsService.createTicket(input);
    revalidatePath("/soporte");
    return { ok: true, id: ticket.id };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that company." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
}

export async function updateTicketStatusAction(id: string, status: TicketStatus): Promise<ActionResult> {
  try {
    await ticketsService.updateTicketStatus(id, status);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that ticket." };
    throw e;
  }
  revalidatePath("/soporte");
  return { ok: true };
}

export async function updateTicketAssigneeAction(id: string, assigneeId: string): Promise<ActionResult> {
  try {
    await ticketsService.updateTicketAssignee(id, assigneeId || null);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that ticket." };
    throw e;
  }
  revalidatePath("/soporte");
  return { ok: true };
}

export async function addTicketMessageAction(id: string, body: string): Promise<ActionResult> {
  try {
    await ticketsService.addTicketMessage(id, body);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that ticket." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/soporte");
  return { ok: true };
}

export async function getTicketOwnerOptionsAction(companyId: string) {
  try {
    return { users: await usersService.getAssignableUsersForCompany(companyId) };
  } catch {
    return { users: [] };
  }
}

export async function getTicketDetailAction(id: string) {
  const result = await ticketsService.getTicket(id);
  return result ?? null;
}

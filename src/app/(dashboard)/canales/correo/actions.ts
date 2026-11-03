"use server";

import { revalidatePath } from "next/cache";
import * as emailService from "@/server/services/email";
import { UnauthorizedError } from "@/server/services/authorization";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";

export type ActionResult = { error?: string; ok?: true };

export async function getContactEmailDetailAction(contactId: string) {
  return emailService.getConversationForContact(contactId);
}

/** Re-fetches the authoritative Unassigned list — used both for the initial
 * tab switch and by the realtime layer (useEmailRealtime) after a WS
 * notification or on (re)connect, same role as Social Media's
 * listConversationsAction. */
export async function listUnassignedEmailConversationsAction() {
  return emailService.listUnassignedEmailConversations();
}

export async function getUnassignedConversationDetailAction(id: string) {
  const result = await emailService.getUnassignedConversationDetail(id);
  return result ?? null;
}

export async function linkEmailConversationToContactAction(conversationId: string, contactId: string): Promise<ActionResult> {
  try {
    await emailService.linkConversationToContact(conversationId, contactId);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that conversation." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/canales/correo");
  return { ok: true };
}

export async function createContactAndLinkEmailConversationAction(
  conversationId: string,
  input: { name: string }
): Promise<ActionResult & { contactId?: string }> {
  try {
    const contact = await emailService.createContactAndLinkConversation(conversationId, input);
    revalidatePath("/canales/correo");
    return { ok: true, contactId: contact.id };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that conversation." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
}

export async function sendEmailAction(input: { contactId: string; subject: string; body: string }): Promise<ActionResult> {
  if (!input.subject.trim()) return { error: "Subject is required." };
  if (!input.body.trim()) return { error: "Message body can't be empty." };

  try {
    await emailService.sendEmailToContact(input);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) return { error: e.message };
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/canales/correo");
  return { ok: true };
}

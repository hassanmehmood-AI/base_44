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

/** attachments arrive as real File objects — Next.js Server Actions
 * support passing File directly as an argument (not just via a <form>
 * submission), so the composer can call this straight from its onClick
 * handler with whatever the user picked. Converted to plain bytes here,
 * at the request boundary, before anything server-side needs to reason
 * about them — the service layer (sendEmailToContact) only ever deals in
 * {filename, mimeType, bytes}, never a browser-specific File type. */
export async function sendEmailAction(
  input: { contactId: string; subject: string; bodyText: string; bodyHtml?: string | null; attachments?: File[] }
): Promise<ActionResult> {
  if (!input.subject.trim()) return { error: "Subject is required." };
  if (!input.bodyText.trim()) return { error: "Message body can't be empty." };

  try {
    const attachments = await Promise.all(
      (input.attachments ?? []).map(async (file) => ({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: new Uint8Array(await file.arrayBuffer()),
      }))
    );
    await emailService.sendEmailToContact({ ...input, attachments });
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) return { error: e.message };
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/canales/correo");
  return { ok: true };
}

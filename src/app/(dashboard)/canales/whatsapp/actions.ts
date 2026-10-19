"use server";

import { revalidatePath } from "next/cache";
import * as whatsappService from "@/server/services/whatsapp";
import { UnauthorizedError } from "@/server/services/authorization";

export type ActionResult = { error?: string; ok?: true };

/** Same role as redes-sociales/actions.ts's listConversationsAction — the
 * realtime layer (useWhatsappRealtime) only ever receives a bare pointer
 * from the WebSocket, never message content, so this authenticated,
 * company-scoped re-fetch is what actually resolves "something changed"
 * into real data. */
export async function listWhatsappConversationsAction() {
  return whatsappService.listWhatsappConversationsForCurrentUser();
}

export async function getWhatsappConversationDetailAction(id: string) {
  const result = await whatsappService.getWhatsappConversation(id);
  return result ?? null;
}

export async function replyToWhatsappConversationAction(conversationId: string, body: string): Promise<ActionResult> {
  if (!body.trim()) return { error: "Message can't be empty." };
  try {
    await whatsappService.replyToWhatsappConversation(conversationId, body);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that conversation." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/canales/whatsapp");
  return { ok: true };
}

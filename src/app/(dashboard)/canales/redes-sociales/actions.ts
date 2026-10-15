"use server";

import { revalidatePath } from "next/cache";
import * as socialService from "@/server/services/social";
import * as usersService from "@/server/services/users";
import { UnauthorizedError } from "@/server/services/authorization";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";

export type ActionResult = { error?: string; ok?: true };

/** Re-fetches the full, authoritative conversation list for the current
 * user — used by the realtime layer (useSocialRealtime) to refresh after a
 * WS notification or on (re)connect. Deliberately the exact same
 * authenticated, company-scoped query page.tsx uses for the initial load:
 * the WS event only ever carries a bare pointer, never message content, so
 * this is what actually resolves "something changed" into real data. */
export async function listConversationsAction() {
  return socialService.listSocialConversationsForCurrentUser();
}

export async function getConversationDetailAction(id: string) {
  const result = await socialService.getConversation(id);
  return result ?? null;
}

export async function replyToConversationAction(conversationId: string, body: string): Promise<ActionResult> {
  if (!body.trim()) return { error: "Message can't be empty." };
  try {
    await socialService.replyToConversation(conversationId, body);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) return { error: e.message };
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that conversation." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/canales/redes-sociales");
  return { ok: true };
}

export async function linkContactAction(conversationId: string, contactId: string): Promise<ActionResult> {
  try {
    await socialService.linkConversationToContact(conversationId, contactId);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that conversation." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/canales/redes-sociales");
  return { ok: true };
}

export async function updateConversationAssigneeAction(conversationId: string, assignedUserId: string): Promise<ActionResult> {
  try {
    await socialService.updateConversationAssignee(conversationId, assignedUserId || null);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that conversation." };
    throw e;
  }
  revalidatePath("/canales/redes-sociales");
  return { ok: true };
}

export async function getAssignableUsersAction(companyId: string) {
  try {
    return { users: await usersService.getAssignableUsersForCompany(companyId) };
  } catch {
    return { users: [] };
  }
}

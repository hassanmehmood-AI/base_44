"use server";

import { revalidatePath } from "next/cache";
import * as emailService from "@/server/services/email";
import { UnauthorizedError } from "@/server/services/authorization";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";

export type ActionResult = { error?: string; ok?: true };

export async function getContactEmailDetailAction(contactId: string) {
  return emailService.getConversationForContact(contactId);
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

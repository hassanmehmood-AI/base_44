"use server";

import { revalidatePath } from "next/cache";
import * as callsService from "@/server/services/calls";
import * as contactsService from "@/server/services/contacts";
import { UnauthorizedError } from "@/server/services/authorization";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";
import type { CallDirection, CallStatus } from "@/server/constants";

export type ActionResult = { error?: string; ok?: true };

export async function getContactCallDetailAction(contactId: string) {
  const [contactResult, calls] = await Promise.all([
    contactsService.getContact(contactId),
    callsService.listCallsForContact(contactId),
  ]);
  return { activities: contactResult?.activities ?? [], calls };
}

export async function initiateCallAction(contactId: string): Promise<ActionResult> {
  try {
    await callsService.initiateCall(contactId);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) return { error: e.message };
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  return { ok: true };
}

export async function logCallResultAction(input: {
  contactId: string;
  direction: CallDirection;
  phoneNumber: string;
  status: CallStatus;
  durationSeconds: string;
  outcome: string;
  notes: string;
  pipelineStageId: string;
}): Promise<ActionResult> {
  try {
    const now = new Date();
    await callsService.logCallResult({
      contactId: input.contactId,
      direction: input.direction,
      phoneNumber: input.phoneNumber,
      status: input.status,
      durationSeconds: input.durationSeconds ? Number(input.durationSeconds) : null,
      outcome: input.outcome.trim() || null,
      notes: input.notes.trim() || null,
      pipelineStageId: input.pipelineStageId || null,
      startedAt: now,
      endedAt: now,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/canales/llamadas");
  return { ok: true };
}

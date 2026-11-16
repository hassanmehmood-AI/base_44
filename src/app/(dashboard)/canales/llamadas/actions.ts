"use server";

import { revalidatePath } from "next/cache";
import * as callsService from "@/server/services/calls";
import * as contactsService from "@/server/services/contacts";
import * as zadarmaWebrtcAuthService from "@/server/services/zadarmaWebrtcAuth";
import { UnauthorizedError } from "@/server/services/authorization";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";
import type { CallDirection, CallStatus } from "@/server/constants";

export type ActionResult = { error?: string; ok?: true };

/** Mints (or refuses to mint, with a clear reason) the signed-in agent's
 * own short-lived WebRTC credential — see zadarmaWebrtcAuth.ts. Never
 * returns anything beyond {sip, key}: no account credentials, no SIP
 * password, ever reach the browser from this action. */
export async function getMyZadarmaWebrtcCredentialsAction(): Promise<zadarmaWebrtcAuthService.WebrtcCredentialsResult> {
  try {
    return await zadarmaWebrtcAuthService.getMyWebrtcCredentials();
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, reason: "auth", message: e.message };
    const message = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, reason: "error", message };
  }
}

export async function getContactCallDetailAction(contactId: string) {
  const [contactResult, calls] = await Promise.all([
    contactsService.getContact(contactId),
    callsService.listCallsForContact(contactId),
  ]);
  return { activities: contactResult?.activities ?? [], calls };
}

/** Refetched after a call result is saved, alongside the per-contact detail
 * — keeps the bottom company-wide call history section current without a
 * full page reload. */
export async function getCompanyCallHistoryAction() {
  return callsService.listCallsForCurrentUser();
}

/** The server-side gate browser calling must pass before the client ever
 * calls Zadarma's widget directly — placeCall() has no server round-trip
 * of its own, so this is what actually enforces company access and lead
 * assignment for that path (see callsService.authorizeCall's doc comment).
 * Returns the contact's own phone number, authoritative and never
 * client-supplied, for the browser to dial exactly that. */
export async function authorizeCallAction(contactId: string): Promise<{ phone?: string; error?: string }> {
  try {
    const { phone } = await callsService.authorizeCall(contactId);
    return { phone };
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) return { error: e.message };
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that contact." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
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

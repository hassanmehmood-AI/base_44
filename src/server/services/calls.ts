import { getDb } from "@/db";
import * as callsRepo from "@/server/repositories/calls";
import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as companiesService from "@/server/services/companies";
import * as contactsService from "@/server/services/contacts";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import * as zadarma from "@/server/integrations/zadarma";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";
import type { CallDirection, CallStatus } from "@/server/constants";

export async function listCallsForCurrentUser() {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  return callsRepo.findManyByCompanyIds(allowed.map((c) => c.id));
}

export async function listCallsForContact(contactId: string) {
  const companyId = await contactsRepo.findCompanyIdById(contactId);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);
  return callsRepo.findManyByContactId(contactId);
}

/** Starts a real Zadarma callback (click-to-call). Throws ProviderNotConfiguredError
 * until ZADARMA_API_KEY/ZADARMA_API_SECRET/ZADARMA_CALLER_NUMBER are set — see
 * guide §16, this integration is scaffolded ahead of real credentials. */
export async function initiateCall(contactId: string) {
  const contact = await contactsRepo.findById(contactId);
  if (!contact) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(contact.companyId);
  if (!contact.phone) throw new Error("This contact has no phone number.");

  const fromNumber = process.env.ZADARMA_CALLER_NUMBER;
  if (!fromNumber) throw new ProviderNotConfiguredError("Zadarma", ["ZADARMA_CALLER_NUMBER"]);

  await zadarma.requestCallback(fromNumber, contact.phone);
}

/** Logs a completed call: persists the structured call record (duration,
 * status, recording, ...) in `calls`, appends a CALL activity to the
 * timeline, and — if a stage was selected — moves the contact via the same
 * moveContactStage() the Kanban board uses (its own STATUS_CHANGE activity),
 * rather than duplicating that transaction here. */
export async function logCallResult(input: {
  contactId: string;
  direction: CallDirection;
  phoneNumber: string;
  status: CallStatus;
  durationSeconds: number | null;
  outcome: string | null;
  notes: string | null;
  pipelineStageId: string | null;
  startedAt: Date;
  endedAt: Date | null;
}) {
  const session = await requireSession();
  const contact = await contactsRepo.findById(input.contactId);
  if (!contact) throw new UnauthorizedError("Contact not found.");
  const companyId = contact.companyId;
  await assertCompanyAccess(companyId);

  const call = await callsRepo.create({
    companyId,
    contactId: input.contactId,
    direction: input.direction,
    phoneNumber: input.phoneNumber,
    status: input.status,
    durationSeconds: input.durationSeconds,
    outcome: input.outcome,
    notes: input.notes,
    calledBy: session.user.id,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  });

  await activitiesRepo.create(getDb(), {
    companyId,
    contactId: input.contactId,
    type: "CALL",
    channel: "CALL",
    outcome: input.outcome,
    notes: input.notes,
    createdBy: session.user.id,
  });

  if (input.pipelineStageId && input.pipelineStageId !== contact.pipelineStageId) {
    await contactsService.moveContactStage(input.contactId, input.pipelineStageId);
  }

  return call;
}

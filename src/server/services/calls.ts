import { getDb } from "@/db";
import * as callsRepo from "@/server/repositories/calls";
import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as companiesService from "@/server/services/companies";
import * as contactsService from "@/server/services/contacts";
import * as zadarmaNumbersRepo from "@/server/repositories/zadarmaNumbers";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import * as zadarma from "@/server/integrations/zadarma";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";
import type { CallDirection, CallStatus } from "@/server/constants";

export async function listCallsForCurrentUser() {
  const session = await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  // Mirrors contactsService.listContactsForCurrentUser's CALL_CENTER_AGENT
  // branch exactly — without this, an agent's "recent call history" showed
  // every call in their company, not just calls on their own assigned
  // leads. Every other role keeps the existing company-wide view.
  if (session.user.roleKey === "CALL_CENTER_AGENT") {
    return callsRepo.findManyByCompanyIdsAndAssignedUser(allowed.map((c) => c.id), session.user.id);
  }
  return callsRepo.findManyByCompanyIds(allowed.map((c) => c.id));
}

export type CompanyCallingStatus = {
  companyId: string;
  companyName: string;
  /** The company's own ACTIVE Zadarma number, or null if none is assigned
   * yet. This is what initiateCall actually dials from (see its own doc
   * comment) — surfaced here so the Calls page can show the real "calling
   * from" number and disable calling before a wasted attempt, instead of
   * only finding out after a failed click-to-call. */
  number: string | null;
};

export type CallingStatusForCurrentUser = {
  /** Account-wide — mirrors zadarma.isZadarmaConfigured(). Lets the UI
   * distinguish "Zadarma itself isn't set up at all" from "Zadarma works
   * fine, this one company just has no number yet" — two different
   * problems with two different fixes (env vars vs. buying a number). */
  zadarmaConfigured: boolean;
  companies: CompanyCallingStatus[];
};

/** DB-only (no Zadarma call) status for every company the signed-in user is
 * allowed to see — same shape/role as Configuración's metricoolStatuses/
 * whapiStatuses, but deliberately NOT Superuser-gated: buying/managing a
 * number is a Superuser action (zadarmaNumberOnboarding.ts), but simply
 * knowing "does my company have a number to call from" is something every
 * Agent/Manager/Director needs just to use this page. Scoped the same way
 * every other allowed-companies query in this app is — never trusts a
 * client-supplied company list. */
export async function getCallingStatusForCurrentUser(): Promise<CallingStatusForCurrentUser> {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  const zadarmaConfigured = zadarma.isZadarmaConfigured();
  if (allowed.length === 0) return { zadarmaConfigured, companies: [] };
  const rows = await zadarmaNumbersRepo.findByCompanyIds(allowed.map((c) => c.id));
  const companies = allowed.map((c) => {
    const active = rows.find((r) => r.companyId === c.id && r.status === "ACTIVE");
    return { companyId: c.id, companyName: c.name, number: active?.number ?? null };
  });
  return { zadarmaConfigured, companies };
}

export async function listCallsForContact(contactId: string) {
  const session = await requireSession();
  const contact = await contactsRepo.findById(contactId);
  if (!contact) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(contact.companyId);
  // Same defense-in-depth as initiateCall/contactsService.getContact: don't
  // rely on every caller routing through getContact first — this function
  // is independently exported and callable, so it enforces the assignment
  // boundary itself too.
  if (session.user.roleKey === "CALL_CENTER_AGENT" && contact.assignedUserId !== session.user.id) {
    throw new UnauthorizedError("You don't have access to that contact.");
  }
  return callsRepo.findManyByContactId(contactId);
}

/** Starts a real Zadarma callback (click-to-call), dialing FROM the calling
 * contact's own company's assigned Zadarma number (see zadarma_numbers,
 * bought/assigned via zadarmaNumberOnboarding.ts — one shared Zadarma
 * account, one number per company) — never a single global number anymore.
 *
 * Two distinct failure modes, never conflated: ProviderNotConfiguredError
 * means Zadarma itself isn't set up yet (missing ZADARMA_API_KEY/SECRET,
 * an account-wide problem); the plain Error below means Zadarma IS working
 * but THIS company specifically has no active number assigned — never
 * silently falls back to a different company's number, same "never guess
 * the sender" principle already used for email/webmail routing. */
/** Shared authorization for "may this session call this contact at all" —
 * company access, plus (for CALL_CENTER_AGENT) the lead-assignment check,
 * plus the contact actually having a phone number. This is the ONE place
 * that decision gets made, used by BOTH calling mechanisms:
 * - initiateCall (the requestCallback fallback) below.
 * - authorizeCall below, which browser calling (Llamadas' ZadarmaPhoneProvider
 *   .placeCall) must pass BEFORE ever reaching Zadarma's widget — placeCall()
 *   itself is pure client-side with no server round-trip of its own, so
 *   without this gate, company/assignment checks would never run at all
 *   for a browser call, only for the callback fallback. */
async function assertCanCallContact(contactId: string) {
  const session = await requireSession();
  const contact = await contactsRepo.findById(contactId);
  if (!contact) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(contact.companyId);
  if (session.user.roleKey === "CALL_CENTER_AGENT" && contact.assignedUserId !== session.user.id) {
    throw new UnauthorizedError("You can only call contacts assigned to you.");
  }
  if (!contact.phone) throw new Error("This contact has no phone number.");
  return contact;
}

/** The server-side gate the browser-calling UI calls before ever placing a
 * call through Zadarma's widget. Returns the contact's own phone number
 * (never a client-supplied one) so the browser dials exactly what the
 * server authorized, never a number typed or tampered with client-side. */
export async function authorizeCall(contactId: string): Promise<{ phone: string }> {
  const contact = await assertCanCallContact(contactId);
  return { phone: contact.phone as string };
}

export async function initiateCall(contactId: string) {
  const contact = await assertCanCallContact(contactId);

  if (!zadarma.isZadarmaConfigured()) {
    throw new ProviderNotConfiguredError("Zadarma", ["ZADARMA_API_KEY", "ZADARMA_API_SECRET"]);
  }

  const assignedNumber = await zadarmaNumbersRepo.findActiveByCompanyId(contact.companyId);
  if (!assignedNumber?.number) {
    throw new Error("This company has no active Zadarma number assigned yet — a Superuser must buy/assign one in Configuración before calls can be made.");
  }

  await zadarma.requestCallback(assignedNumber.number, contact.phone as string);
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

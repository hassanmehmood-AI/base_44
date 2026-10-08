import { getDb } from "@/db";
import * as conversationsRepo from "@/server/repositories/conversations";
import * as messagesRepo from "@/server/repositories/messages";
import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as companiesService from "@/server/services/companies";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import * as emailProvider from "@/server/integrations/email";
import { isValidEmailFormat } from "@/lib/email";

const CHANNEL = "EMAIL";

export type EmailSenderStatus = {
  fromAddress: string | null;
  /** Deliberately never "Connected" — isEmailConfigured() only checks that
   * credentials are present, not that Resend has actually accepted them.
   * "Not Verified" is the honest status until a real verified-send (or a
   * dedicated provider health check) exists. */
  status: "NOT_CONFIGURED" | "NOT_VERIFIED";
};

/** Session-gated (consistent with every other read in this module) even
 * though the sender address itself isn't per-company secret data — there is
 * exactly one sender account for the whole app (EMAIL_FROM_ADDRESS), not a
 * per-company selection, so there's nothing to choose between here. */
export async function getEmailSenderStatus(): Promise<EmailSenderStatus> {
  await requireSession();
  if (!emailProvider.isEmailConfigured()) {
    return { fromAddress: null, status: "NOT_CONFIGURED" };
  }
  return { fromAddress: emailProvider.getEmailSenderAddress(), status: "NOT_VERIFIED" };
}

export async function listEmailConversationsForCurrentUser() {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  return conversationsRepo.findManyByCompanyIdsAndChannel(allowed.map((c) => c.id), CHANNEL);
}

export async function getConversation(id: string) {
  const conversation = await conversationsRepo.findById(id);
  if (!conversation) return undefined;
  await assertCompanyAccess(conversation.companyId);
  const messages = await messagesRepo.findByConversationId(id);
  return { conversation, messages };
}

/** Thread for a given contact, if one exists yet — there's no inbound email
 * receiving mechanism scaffolded yet (see guide §16), so a conversation only
 * exists once an agent has sent at least one email to this contact. */
export async function getConversationForContact(contactId: string) {
  const companyId = await contactsRepo.findCompanyIdById(contactId);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);

  const conversation = await conversationsRepo.findByContactIdAndChannel(contactId, CHANNEL);
  if (!conversation) return { conversation: null, messages: [] };
  const messages = await messagesRepo.findByConversationId(conversation.id);
  return { conversation, messages };
}

/** Finds the contact's existing EMAIL conversation or starts one, sends a
 * real email through the provider wrapper (throws ProviderNotConfiguredError
 * until credentials exist), then persists the outbound message, bumps the
 * conversation's lastMessageAt, and appends an EMAIL activity to the
 * contact's timeline — same "real interaction = real activity" pattern as
 * calls (see services/calls.ts). Nothing is persisted if the send fails. */
export async function sendEmailToContact(input: { contactId: string; subject: string; body: string }) {
  const session = await requireSession();
  const contact = await contactsRepo.findById(input.contactId);
  if (!contact) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(contact.companyId);
  if (!contact.email) throw new Error("This contact has no email address.");
  if (!isValidEmailFormat(contact.email)) throw new Error("This contact's email address isn't valid.");
  if (!input.subject.trim()) throw new Error("Subject is required.");
  if (!input.body.trim()) throw new Error("Message body can't be empty.");

  const { externalId } = await emailProvider.sendEmail({
    to: contact.email,
    subject: input.subject,
    body: input.body,
  });

  let conversation = await conversationsRepo.findByContactIdAndChannel(input.contactId, CHANNEL);
  if (!conversation) {
    conversation = await conversationsRepo.create({
      companyId: contact.companyId,
      contactId: input.contactId,
      channel: CHANNEL,
      subject: input.subject,
      assignedUserId: session.user.id,
    });
  }

  const now = new Date();
  await messagesRepo.create({
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderLabel: session.user.name,
    body: input.body,
    metadata: externalId ? { externalId } : null,
    createdBy: session.user.id,
    sentAt: now,
  });
  await conversationsRepo.updateLastMessageAt(conversation.id, now);

  await activitiesRepo.create(getDb(), {
    companyId: contact.companyId,
    contactId: input.contactId,
    type: "EMAIL",
    channel: "EMAIL",
    outcome: null,
    notes: input.subject,
    createdBy: session.user.id,
  });

  return conversation;
}

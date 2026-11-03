import { getDb } from "@/db";
import * as conversationsRepo from "@/server/repositories/conversations";
import type { Conversation } from "@/server/repositories/conversations";
import * as messagesRepo from "@/server/repositories/messages";
import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as pipelineStagesRepo from "@/server/repositories/pipelineStages";
import * as companyEmailAccountsRepo from "@/server/repositories/companyEmailAccounts";
import * as companiesService from "@/server/services/companies";
import * as contactsService from "@/server/services/contacts";
import * as emailOnboardingService from "@/server/services/emailOnboarding";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import * as emailProvider from "@/server/integrations/email";
import { isValidEmailFormat } from "@/lib/email";

const CHANNEL = "EMAIL";

export type EmailSenderStatus = {
  fromAddress: string | null;
  /** Deliberately never "Connected" for the Resend path — isEmailConfigured()
   * only checks that credentials are present, not that Resend has actually
   * accepted them. "Not Verified" is the honest status until a real
   * verified-send (or a dedicated provider health check) exists.
   * CONNECTED_GMAIL is different: a connected Gmail mailbox either IS
   * ACTIVE (OAuth already fully succeeded, tokens on file — see
   * company_email_accounts.status) or it isn't, there's no equivalent
   * "configured but unverified" middle state for it. */
  status: "NOT_CONFIGURED" | "NOT_VERIFIED" | "CONNECTED_GMAIL";
};

/** Which provider a reply in this conversation will actually send through —
 * resolved from the conversation itself (conversations.companyEmailAccountId,
 * set once at creation by gmailSync.ts's resolveConversation / this file's
 * own sendEmailToContact — see schema.ts's doc comment on that column),
 * never a company-wide setting. A conversation with no connected mailbox on
 * it (the overwhelming majority today, since this column only exists going
 * forward) keeps using the single global Resend sender, completely
 * unchanged. Exported so sendEmailToContact and getConversationForContact
 * can never disagree about which provider a given conversation uses. */
async function resolveSenderStatus(conversation: Conversation | null): Promise<EmailSenderStatus> {
  if (conversation?.companyEmailAccountId) {
    const account = await companyEmailAccountsRepo.findById(conversation.companyEmailAccountId);
    if (account && account.status === "ACTIVE") {
      return { fromAddress: account.emailAddress, status: "CONNECTED_GMAIL" };
    }
  }
  if (!emailProvider.isEmailConfigured()) {
    return { fromAddress: null, status: "NOT_CONFIGURED" };
  }
  return { fromAddress: emailProvider.getEmailSenderAddress(), status: "NOT_VERIFIED" };
}

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

/** Thread for a given contact, if one exists yet — a conversation exists
 * once either an agent has sent at least one email to this contact, or an
 * inbound Gmail message from their address has been matched to them (see
 * gmailSync.ts's resolveConversation). Also resolves which provider a
 * reply here will actually use (see resolveSenderStatus) so the UI can show
 * the right "From" address/availability without a second round trip. */
export async function getConversationForContact(contactId: string) {
  const companyId = await contactsRepo.findCompanyIdById(contactId);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);

  const conversation = await conversationsRepo.findByContactIdAndChannel(contactId, CHANNEL);
  const senderStatus = await resolveSenderStatus(conversation ?? null);
  if (!conversation) return { conversation: null, messages: [], senderStatus };
  const messages = await messagesRepo.findByConversationId(conversation.id);
  return { conversation, messages, senderStatus };
}

/** Finds the contact's existing EMAIL conversation or starts one, sends a
 * real email, then persists the outbound message, bumps the conversation's
 * lastMessageAt, and appends an EMAIL activity to the contact's timeline —
 * same "real interaction = real activity" pattern as calls (see
 * services/calls.ts). Nothing is persisted if the send fails.
 *
 * Provider selection mirrors resolveSenderStatus exactly (so the UI's
 * "From" address is never a lie about what actually happens on send): if
 * this contact's EXISTING conversation already has a connected Gmail
 * mailbox on it, the reply goes out through that exact mailbox (so it lands
 * in the same real thread the contact sees) — not silently through Resend
 * instead, which would confuse the recipient about which address the
 * reply came from. A mailbox that's since gone NEEDS_REAUTH/disconnected is
 * surfaced as a clear, actionable error rather than silently falling back.
 * A brand-new conversation (no companyEmailAccountId yet — the common
 * case) keeps using the single global Resend sender, completely
 * unchanged. */
export async function sendEmailToContact(input: { contactId: string; subject: string; body: string }) {
  const session = await requireSession();
  const contact = await contactsRepo.findById(input.contactId);
  if (!contact) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(contact.companyId);
  if (!contact.email) throw new Error("This contact has no email address.");
  if (!isValidEmailFormat(contact.email)) throw new Error("This contact's email address isn't valid.");
  if (!input.subject.trim()) throw new Error("Subject is required.");
  if (!input.body.trim()) throw new Error("Message body can't be empty.");

  let conversation = await conversationsRepo.findByContactIdAndChannel(input.contactId, CHANNEL);

  let externalId: string | null;
  if (conversation?.companyEmailAccountId) {
    const account = await companyEmailAccountsRepo.findById(conversation.companyEmailAccountId);
    if (!account) throw new Error("The connected mailbox for this conversation no longer exists.");
    if (account.status !== "ACTIVE") throw new Error("This mailbox needs to be reconnected before you can reply — go to Configuración.");
    const result = await emailOnboardingService.sendFromAccount(account.id, {
      to: contact.email,
      subject: input.subject,
      body: input.body,
    });
    externalId = result.externalId;
  } else {
    const result = await emailProvider.sendEmail({
      to: contact.email,
      subject: input.subject,
      body: input.body,
    });
    externalId = result.externalId;
  }

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

/** The Unassigned Email Inbox — see gmailSync.ts's resolveConversation doc
 * comment for why these exist: an inbound message whose sender didn't match
 * any CRM contact on file. Listed separately from listEmailConversationsForCurrentUser
 * (which only returns conversations already linked to a contact, since
 * that's all getConversationForContact's contactId-keyed lookup can ever
 * show) so Correo's Unassigned tab has something to read from. */
export async function listUnassignedEmailConversations() {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  return conversationsRepo.findUnassignedEmailByCompanyIds(allowed.map((c) => c.id));
}

export async function getUnassignedConversationDetail(id: string) {
  const conversation = await conversationsRepo.findById(id);
  if (!conversation) return undefined;
  await assertCompanyAccess(conversation.companyId);
  const messages = await messagesRepo.findByConversationId(id);
  return { conversation, messages };
}

/** Links an Unassigned conversation to an existing CRM contact — the
 * manual-review step of the Unassigned Email Inbox (deliberately never
 * automatic; see this feature's approved design). Mirrors services/
 * social.ts's linkConversationToContact, with one addition specific to
 * email: since messages are append-only (no UPDATE/DELETE allowed — see
 * db/migrations/0001_append_only_triggers.sql) a message's conversationId
 * can never be reassigned, so if the target contact already has an EMAIL
 * conversation there is no safe way to merge the two threads' messages
 * into one row. That case is therefore rejected with a clear, actionable
 * error rather than silently duplicating or losing anything — a narrow,
 * documented limitation (see the PASS/FAIL report), not a silent gap. */
export async function linkConversationToContact(conversationId: string, contactId: string) {
  const conversation = await conversationsRepo.findById(conversationId);
  if (!conversation) throw new UnauthorizedError("Conversation not found.");
  await assertCompanyAccess(conversation.companyId);
  if (conversation.contactId) throw new Error("This conversation is already linked to a contact.");

  const contactCompanyId = await contactsRepo.findCompanyIdById(contactId);
  if (!contactCompanyId || contactCompanyId !== conversation.companyId) {
    throw new Error("Contact must belong to the same company as this email thread.");
  }

  const existing = await conversationsRepo.findByContactIdAndChannel(contactId, CHANNEL);
  if (existing) {
    throw new Error(
      "This contact already has an email conversation — open it from the Contacts list instead of linking a second thread."
    );
  }

  return conversationsRepo.updateContactId(conversationId, contactId);
}

/** senderEmail is written into metadata only for INBOUND messages (see
 * gmailSync.ts) — scans newest-first since the most recent inbound message
 * is the most likely to reflect who's actually writing in on an
 * old/ongoing unassigned thread. */
function findSenderEmailInMessages(messages: messagesRepo.Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const senderEmail = (messages[i].metadata as { senderEmail?: string } | null)?.senderEmail;
    if (senderEmail) return senderEmail;
  }
  return null;
}

/** Creates a brand-new CRM contact and links it to this Unassigned
 * conversation in one step — the other half of the manual-review flow
 * (deliberately a separate, explicit, agent-initiated action; see
 * linkConversationToContact's doc comment on why this is never automatic).
 * Reuses contactsService.createContact as-is — same round-robin
 * auto-assignment and Manager-ownership stamping any other manually-created
 * contact gets, since from the CRM's perspective this genuinely is a new
 * lead an agent just chose to create, not a side effect of ingestion.
 * Defaults to the shared pipeline's first stage (NUEVO_LEAD by convention —
 * see services/campaigns.ts's identical assumption) so the quick-create
 * form only needs a name. */
export async function createContactAndLinkConversation(conversationId: string, input: { name: string }) {
  const conversation = await conversationsRepo.findById(conversationId);
  if (!conversation) throw new UnauthorizedError("Conversation not found.");
  await assertCompanyAccess(conversation.companyId);
  if (conversation.contactId) throw new Error("This conversation is already linked to a contact.");
  if (!input.name.trim()) throw new Error("Name is required.");

  const stages = await pipelineStagesRepo.findDefaultPipelineStages();
  const defaultStage = stages[0];
  if (!defaultStage) throw new Error("No pipeline stages are configured — contact an administrator.");

  const messages = await messagesRepo.findByConversationId(conversationId);
  const senderEmail = findSenderEmailInMessages(messages);

  const contact = await contactsService.createContact({
    companyId: conversation.companyId,
    name: input.name.trim(),
    email: senderEmail,
    pipelineStageId: defaultStage.id,
  });

  await conversationsRepo.updateContactId(conversationId, contact.id);
  return contact;
}

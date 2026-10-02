import { getDb } from "@/db";
import * as conversationsRepo from "@/server/repositories/conversations";
import * as messagesRepo from "@/server/repositories/messages";
import * as companySocialAccountsRepo from "@/server/repositories/companySocialAccounts";
import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as companiesService from "@/server/services/companies";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import * as metaProvider from "@/server/integrations/meta";

const CHANNEL = "SOCIAL";

export async function listSocialConversationsForCurrentUser() {
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

export async function replyToConversation(conversationId: string, body: string) {
  const session = await requireSession();
  const conversation = await conversationsRepo.findById(conversationId);
  if (!conversation) throw new UnauthorizedError("Conversation not found.");
  await assertCompanyAccess(conversation.companyId);
  if (!conversation.externalThreadId) throw new Error("This conversation has no external sender id to reply to.");

  await metaProvider.sendMessage(conversation.externalThreadId, body);

  const now = new Date();
  await messagesRepo.create({
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderLabel: session.user.name,
    body,
    createdBy: session.user.id,
    sentAt: now,
  });
  await conversationsRepo.updateLastMessageAt(conversation.id, now);

  if (conversation.contactId) {
    await activitiesRepo.create(getDb(), {
      companyId: conversation.companyId,
      contactId: conversation.contactId,
      type: "SOCIAL",
      channel: "SOCIAL",
      outcome: null,
      notes: body,
      createdBy: session.user.id,
    });
  }
}

/** The "contact association" step from guide §16 — inbound social messages
 * arrive without a CRM contact (Meta only gives a page-scoped sender id), so
 * an agent links the conversation to an existing contact once identified. */
export async function linkConversationToContact(conversationId: string, contactId: string) {
  const conversation = await conversationsRepo.findById(conversationId);
  if (!conversation) throw new UnauthorizedError("Conversation not found.");
  await assertCompanyAccess(conversation.companyId);

  const contactCompanyId = await contactsRepo.findCompanyIdById(contactId);
  if (!contactCompanyId || contactCompanyId !== conversation.companyId) {
    throw new Error("Contact must belong to the same company as the conversation.");
  }

  return conversationsRepo.updateContactId(conversationId, contactId);
}

export async function updateConversationAssignee(conversationId: string, assignedUserId: string | null) {
  const conversation = await conversationsRepo.findById(conversationId);
  if (!conversation) throw new UnauthorizedError("Conversation not found.");
  await assertCompanyAccess(conversation.companyId);
  return conversationsRepo.updateAssignee(conversationId, assignedUserId);
}

/** Webhook entry point — no user session exists here, so this does NOT go
 * through requireSession/assertCompanyAccess. Authorization instead comes
 * from the signature check the route handler already did, plus resolving
 * the company strictly via the page's registered company_social_accounts
 * row (unknown pages are rejected, not guessed). */
export async function ingestInboundMessage(input: {
  platform: string;
  pageId: string;
  senderId: string;
  senderHandle: string | null;
  text: string;
}) {
  const companyId = await companySocialAccountsRepo.findCompanyIdByExternalPage(input.platform, input.pageId);
  if (!companyId) {
    throw new Error(`No company connected to ${input.platform} page ${input.pageId}.`);
  }

  let conversation = await conversationsRepo.findByExternalThreadId(companyId, CHANNEL, input.senderId);
  if (!conversation) {
    conversation = await conversationsRepo.create({
      companyId,
      channel: CHANNEL,
      externalThreadId: input.senderId,
      subject: input.senderHandle,
    });
  }

  const now = new Date();
  await messagesRepo.create({
    conversationId: conversation.id,
    direction: "INBOUND",
    senderLabel: input.senderHandle,
    body: input.text,
    sentAt: now,
  });
  await conversationsRepo.updateLastMessageAt(conversation.id, now);

  return conversation;
}

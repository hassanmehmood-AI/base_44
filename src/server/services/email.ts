import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as conversationsRepo from "@/server/repositories/conversations";
import type { Conversation, ConversationWithJoins } from "@/server/repositories/conversations";
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
import { sanitizeEmailHtml } from "@/lib/emailHtml";
import { validateAttachment, MAX_TOTAL_ATTACHMENT_BYTES, formatFileSize } from "@/lib/emailAttachments";
import type { StoredEmailAttachment } from "@/lib/emailAttachments";
import * as attachmentStorage from "@/server/integrations/emailAttachmentStorage";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";

const CHANNEL = "EMAIL";

export type EmailSenderStatus = {
  fromAddress: string | null;
  /** Deliberately never "Connected" for the Resend path — isEmailConfigured()
   * only checks that credentials are present, not that Resend has actually
   * accepted them. "Not Verified" is the honest status until a real
   * verified-send (or a dedicated provider health check) exists.
   * CONNECTED_GMAIL/CONNECTED_SMTP are different: a connected mailbox
   * either IS ACTIVE (its credentials already fully verified at connect
   * time, on file — see company_email_accounts.status) or it isn't, there's
   * no equivalent "configured but unverified" middle state for either.
   * CHOOSE_SENDER is the unified-inbox addition: a brand-new conversation
   * (no companyEmailAccountId yet) whose company has 2+ active mailboxes —
   * fromAddress is null here on purpose, since there isn't one single
   * answer yet; the UI must show the sender-picker (see
   * getAvailableSenderAccountsForContact) rather than a fixed address. */
  status: "NOT_CONFIGURED" | "NOT_VERIFIED" | "CONNECTED_GMAIL" | "CONNECTED_SMTP" | "CHOOSE_SENDER";
};

/** Which provider a reply in this conversation will actually send through —
 * resolved from the conversation itself (conversations.companyEmailAccountId,
 * set once at creation by gmailSync.ts's resolveConversation / this file's
 * own sendEmailToContact — see schema.ts's doc comment on that column),
 * never a company-wide setting. A conversation with no connected mailbox on
 * it (the overwhelming majority today, since this column only exists going
 * forward) keeps using the single global Resend sender, completely
 * unchanged. Exported so sendEmailToContact and getConversationForContact
 * can never disagree about which provider a given conversation uses.
 *
 * companyId is required now (previously this only looked at the
 * conversation) so a BRAND-NEW conversation — the common "first message to
 * this contact" case, where conversation is null — can still correctly
 * reflect a connected company mailbox instead of incorrectly falling
 * through to the Resend/NOT_CONFIGURED status. This is the fix for the
 * unified-inbox audit's core finding: a new conversation never looked at
 * the company's connected mailboxes at all before this. */
async function resolveSenderStatus(conversation: Conversation | null, companyId: string): Promise<EmailSenderStatus> {
  if (conversation?.companyEmailAccountId) {
    const account = await companyEmailAccountsRepo.findById(conversation.companyEmailAccountId);
    if (account && account.status === "ACTIVE") {
      return { fromAddress: account.emailAddress, status: account.provider === "SMTP_IMAP" ? "CONNECTED_SMTP" : "CONNECTED_GMAIL" };
    }
    // A conversation that already HAS a connected mailbox, but that mailbox
    // is no longer ACTIVE (NEEDS_REAUTH/disconnected): deliberately does
    // NOT fall through to the Resend status below — that would silently
    // misrepresent what a send will actually do. sendEmailToContact already
    // throws a clear "reconnect this mailbox" error for exactly this case;
    // this status falls through to NOT_VERIFIED/NOT_CONFIGURED only for a
    // conversation that genuinely has no mailbox at all, never one with a
    // broken one.
  } else if (!conversation) {
    // Brand-new conversation — ask the company's own active mailboxes,
    // never a company-wide setting. Exactly one of 0/1/2+.
    const accounts = (await companyEmailAccountsRepo.findByCompanyId(companyId)).filter((a) => a.status === "ACTIVE");
    if (accounts.length === 1) {
      const account = accounts[0];
      return { fromAddress: account.emailAddress, status: account.provider === "SMTP_IMAP" ? "CONNECTED_SMTP" : "CONNECTED_GMAIL" };
    }
    if (accounts.length > 1) {
      return { fromAddress: null, status: "CHOOSE_SENDER" };
    }
  }
  if (!emailProvider.isEmailConfigured()) {
    return { fromAddress: null, status: "NOT_CONFIGURED" };
  }
  return { fromAddress: emailProvider.getEmailSenderAddress(), status: "NOT_VERIFIED" };
}

export type AvailableSenderAccount = { id: string; emailAddress: string; provider: "GOOGLE_WORKSPACE" | "SMTP_IMAP" };

/** The company's active mailboxes, for the "Send from" picker — only ever
 * needed (and only ever rendered by the client) when resolveSenderStatus
 * above returns CHOOSE_SENDER (2+ active mailboxes, brand-new conversation).
 * Returns an empty list in every other case, which the UI treats as "no
 * picker needed," same convention as other optional-UI lookups in this app
 * (e.g. getContactTasksAction). */
export async function getAvailableSenderAccountsForContact(contactId: string): Promise<AvailableSenderAccount[]> {
  const companyId = await contactsRepo.findCompanyIdById(contactId);
  if (!companyId) return [];
  await assertCompanyAccess(companyId);
  const accounts = await companyEmailAccountsRepo.findByCompanyId(companyId);
  return accounts
    .filter((a) => a.status === "ACTIVE")
    .map((a) => ({ id: a.id, emailAddress: a.emailAddress, provider: a.provider === "SMTP_IMAP" ? "SMTP_IMAP" as const : "GOOGLE_WORKSPACE" as const }));
}

/** Resolves which company_email_accounts row (if any) a BRAND-NEW
 * conversation should be created with — the fix for the audit's core
 * finding. Only ever called when no conversation exists yet; an existing
 * conversation's account is already fixed (see sendEmailToContact) and is
 * never re-resolved here.
 *   - 0 active mailboxes -> null (the existing Resend fallback, unchanged)
 *   - exactly 1 -> that one, automatically, with no UI choice needed
 *   - 2+ -> the caller MUST have picked one (requestedAccountId); a
 *     missing or invalid choice is a clear error, never a silent guess —
 *     "never silently switch the sender" applies just as much to a
 *     brand-new conversation as to an existing one. requestedAccountId is
 *     always re-validated against THIS company's own accounts (never
 *     trusted blindly), so a tampered id from another company is rejected
 *     the same way assertCompanyAccess rejects everything else. */
async function resolveAccountForNewConversation(
  companyId: string,
  requestedAccountId: string | undefined
): Promise<{ id: string; provider: string } | null> {
  const accounts = (await companyEmailAccountsRepo.findByCompanyId(companyId)).filter((a) => a.status === "ACTIVE");
  if (accounts.length === 0) return null;
  if (accounts.length === 1) return { id: accounts[0].id, provider: accounts[0].provider };

  if (!requestedAccountId) {
    throw new Error("This company has more than one connected mailbox — choose which one to send from.");
  }
  const chosen = accounts.find((a) => a.id === requestedAccountId);
  if (!chosen) {
    throw new Error("The selected mailbox isn't a valid, active mailbox for this company.");
  }
  return { id: chosen.id, provider: chosen.provider };
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

/** A contact can now have more than one EMAIL conversation — one per
 * connected company mailbox that's actually exchanged mail with them (see
 * imapSync.ts's resolveConversation and sendEmailToContact/
 * linkConversationToContact below) — so this is a list of distinct
 * providers, not a single value. A contact with no entry simply has no
 * EMAIL conversation yet (or only a legacy Resend-fallback one, provider:
 * null, which the "All" filter already covers without an explicit entry). */
export type EmailProviderByContact = Record<string, ("GOOGLE_WORKSPACE" | "SMTP_IMAP")[]>;

/** Powers Correo's Contacts-tab provider badges/filter. */
export async function getEmailProvidersByContact(): Promise<EmailProviderByContact> {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  const rows = await conversationsRepo.findEmailProvidersByCompanyIds(allowed.map((c) => c.id));
  const map: EmailProviderByContact = {};
  for (const r of rows) {
    const provider = r.provider === "SMTP_IMAP" ? "SMTP_IMAP" : r.provider === "GOOGLE_WORKSPACE" ? "GOOGLE_WORKSPACE" : null;
    if (!provider) continue;
    const list = map[r.contactId] ?? (map[r.contactId] = []);
    if (!list.includes(provider)) list.push(provider);
  }
  return map;
}

export async function getConversation(id: string) {
  const conversation = await conversationsRepo.findById(id);
  if (!conversation) return undefined;
  await assertCompanyAccess(conversation.companyId);
  const messages = await messagesRepo.findByConversationId(id);
  return { conversation, messages };
}

/** Thread(s) for a given contact — a contact can now have more than one
 * EMAIL conversation, one per connected company mailbox that's actually
 * exchanged mail with them (see imapSync.ts's resolveConversation and
 * sendEmailToContact below), each permanently bound to its own mailbox for
 * replies. `conversations` is the full list (newest-first, each carrying
 * its own emailProvider) so the UI can offer a thread picker when there's
 * more than one; `conversation`/`messages`/`senderStatus` describe whichever
 * one is actually selected — the one matching `conversationId` if given and
 * valid for this contact, else the most recent. A conversationId that
 * doesn't belong to this contact is rejected the same way any other
 * cross-resource access attempt in this app is, rather than silently
 * falling back to a different thread. */
export async function getConversationForContact(contactId: string, conversationId?: string) {
  const companyId = await contactsRepo.findCompanyIdById(contactId);
  if (!companyId) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(companyId);

  const conversations = await conversationsRepo.findAllByContactIdAndChannel(contactId, CHANNEL);
  let conversation: ConversationWithJoins | null;
  if (conversationId) {
    const match = conversations.find((c) => c.id === conversationId);
    if (!match) throw new UnauthorizedError("Conversation not found for this contact.");
    conversation = match;
  } else {
    conversation = conversations[0] ?? null;
  }

  const senderStatus = await resolveSenderStatus(conversation, companyId);
  if (!conversation) return { conversations, conversation: null, messages: [], senderStatus };
  const messages = await messagesRepo.findByConversationId(conversation.id);
  return { conversations, conversation, messages, senderStatus };
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
/** Validates every candidate attachment (type + per-file size + combined
 * size, see lib/emailAttachments.ts) and, only if ALL pass, uploads each to
 * permanent storage before returning both the metadata to persist on the
 * created message (storedAttachments) and the raw bytes to actually
 * transmit (outboundAttachments) — kept as two separate shapes rather than
 * one, since the message record should reference the storage key (never
 * raw bytes in the DB), while the provider send call needs the opposite.
 * Throws a clear, specific error (naming the offending file) on the first
 * validation failure, before uploading anything — see sendEmailToContact's
 * doc comment on why this fails closed rather than best-effort. */
async function validateAndStoreOutboundAttachments(
  companyId: string,
  attachments: { filename: string; mimeType: string; bytes: Uint8Array }[]
): Promise<{ storedAttachments: StoredEmailAttachment[]; outboundAttachments: { filename: string; mimeType: string; bytes: Uint8Array }[] }> {
  if (attachments.length === 0) return { storedAttachments: [], outboundAttachments: [] };

  if (!attachmentStorage.isAttachmentStorageConfigured()) {
    throw new ProviderNotConfiguredError("Email attachment storage", [
      "AVATAR_STORAGE_ENDPOINT",
      "AVATAR_STORAGE_BUCKET",
      "AVATAR_STORAGE_ACCESS_KEY_ID",
      "AVATAR_STORAGE_SECRET_ACCESS_KEY",
    ]);
  }

  const totalSize = attachments.reduce((sum, a) => sum + a.bytes.byteLength, 0);
  if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(`Attachments total ${formatFileSize(totalSize)}, which is over the ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)} limit.`);
  }
  for (const attachment of attachments) {
    const validationError = validateAttachment(attachment.mimeType, attachment.bytes.byteLength);
    if (validationError === "TYPE_NOT_ALLOWED") {
      throw new Error(`"${attachment.filename}" isn't a supported file type. Allowed: PDF, DOCX, XLSX, JPG, PNG.`);
    }
    if (validationError === "TOO_LARGE") {
      throw new Error(`"${attachment.filename}" (${formatFileSize(attachment.bytes.byteLength)}) is too large.`);
    }
  }

  // One batch id for this whole send — see emailAttachmentStorage.ts's
  // buildAttachmentKey doc comment on why a real message id isn't
  // available yet at this point.
  const batchId = randomUUID();
  const storedAttachments: StoredEmailAttachment[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const key = attachmentStorage.buildAttachmentKey(companyId, batchId, index, attachment.filename);
    await attachmentStorage.putAttachment(key, attachment.bytes, attachment.mimeType);
    storedAttachments.push({ filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.bytes.byteLength, key });
  }

  return { storedAttachments, outboundAttachments: attachments };
}

export async function sendEmailToContact(input: {
  contactId: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  attachments?: { filename: string; mimeType: string; bytes: Uint8Array }[];
  /** Which of this contact's (possibly several) EMAIL conversations to
   * reply within — required once a contact has more than one, since the
   * server refuses to guess which mailbox you meant to reply from (same
   * "never guess" principle as resolveAccountForNewConversation below).
   * Omit only when the contact has zero or exactly one EMAIL conversation;
   * ignored (never trusted over the conversation's own stored account)
   * once resolved — see the conversation-resolution block below. */
  conversationId?: string;
  /** Only consulted for a BRAND-NEW conversation whose company has 2+
   * active mailboxes (see resolveAccountForNewConversation) — ignored
   * entirely once a conversation already exists, since that conversation's
   * own companyEmailAccountId is always the one source of truth from then
   * on (requirement: never silently switch an existing thread's sender). */
  accountId?: string;
}) {
  const session = await requireSession();
  const contact = await contactsRepo.findById(input.contactId);
  if (!contact) throw new UnauthorizedError("Contact not found.");
  await assertCompanyAccess(contact.companyId);
  if (!contact.email) throw new Error("This contact has no email address.");
  if (!isValidEmailFormat(contact.email)) throw new Error("This contact's email address isn't valid.");
  if (!input.subject.trim()) throw new Error("Subject is required.");
  if (!input.bodyText.trim()) throw new Error("Message body can't be empty.");

  // Never trust client-supplied HTML, even from our own composer — sanitize
  // here too (see lib/emailHtml.ts), same as inbound messages, before it is
  // ever sent or stored.
  const safeHtml = input.bodyHtml ? sanitizeEmailHtml(input.bodyHtml) : null;

  // Validated and uploaded BEFORE the send call — deliberately fail-closed
  // here: an email must never actually go out with an attachment the CRM
  // then can't display, and the user gets a clear, actionable error (wrong
  // type / too large) instead of a silently dropped file. Unlike inbound
  // sync's best-effort per-attachment skip (see gmailSync.ts), this is a
  // user-initiated action with no "mostly worked" acceptable outcome.
  const { storedAttachments, outboundAttachments } = await validateAndStoreOutboundAttachments(
    contact.companyId,
    input.attachments ?? []
  );

  // Multi-mailbox-per-contact resolution: a specific conversationId is
  // always trusted as-is (ownership-checked below) and never re-resolved —
  // same "existing conversation's account is the one source of truth"
  // principle as before, now explicit about WHICH conversation that is.
  // Without one, fall back to the contact's own EMAIL conversations: exactly
  // one is unambiguous and reused automatically (the common case, and what
  // keeps this a non-breaking default for every contact who only ever used
  // one mailbox); two or more means the caller must say which thread this
  // reply belongs to, since guessing would risk sending from the wrong
  // mailbox; zero means this is genuinely a brand-new conversation.
  let conversation: Conversation | ConversationWithJoins | undefined;
  if (input.conversationId) {
    const found = await conversationsRepo.findById(input.conversationId);
    if (!found || found.contactId !== input.contactId || found.channel !== CHANNEL) {
      throw new UnauthorizedError("Conversation not found for this contact.");
    }
    conversation = found;
  } else {
    const existingConversations = await conversationsRepo.findAllByContactIdAndChannel(input.contactId, CHANNEL);
    if (existingConversations.length > 1) {
      throw new Error("This contact has more than one email conversation — open the specific thread you want to reply to before sending.");
    }
    conversation = existingConversations[0];
  }

  // Unified-inbox fix: for an EXISTING conversation, its own
  // companyEmailAccountId remains the one and only source of truth (never
  // re-resolved, never influenced by input.accountId) — this is what makes
  // "replies always use the same connected mailbox" true. For a BRAND-NEW
  // conversation, resolveAccountForNewConversation picks (or requires a
  // choice for) the company's own active mailbox; `null` means the
  // existing Resend fallback, completely unchanged.
  const resolvedAccount = conversation?.companyEmailAccountId
    ? null // existing conversation already has its own account below
    : await resolveAccountForNewConversation(contact.companyId, input.accountId);

  let externalId: string | null;
  if (conversation?.companyEmailAccountId) {
    const account = await companyEmailAccountsRepo.findById(conversation.companyEmailAccountId);
    if (!account) throw new Error("The connected mailbox for this conversation no longer exists.");
    if (account.status !== "ACTIVE") throw new Error("This mailbox needs to be reconnected before you can reply — go to Configuración.");
    const result = await emailOnboardingService.sendFromAccount(account.id, {
      to: contact.email,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: safeHtml,
      attachments: outboundAttachments,
    });
    externalId = result.externalId;
  } else if (resolvedAccount) {
    const result = await emailOnboardingService.sendFromAccount(resolvedAccount.id, {
      to: contact.email,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: safeHtml,
      attachments: outboundAttachments,
    });
    externalId = result.externalId;
  } else {
    const result = await emailProvider.sendEmail({
      to: contact.email,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: safeHtml,
      attachments: outboundAttachments,
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
      // The actual fix: a brand-new conversation now permanently remembers
      // which company mailbox it was sent through (or stays null for the
      // Resend fallback, unchanged) — previously this was never set here at
      // all, so every future reply on this thread silently reverted to
      // Resend even when a connected mailbox existed and was used for the
      // very first message.
      companyEmailAccountId: resolvedAccount?.id ?? null,
    });
  }

  const now = new Date();
  const metadata: Record<string, unknown> = {};
  if (externalId) metadata.externalId = externalId;
  if (safeHtml) metadata.bodyHtml = safeHtml;
  if (storedAttachments.length > 0) metadata.attachments = storedAttachments;

  await messagesRepo.create({
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderLabel: session.user.name,
    body: input.bodyText,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
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
 * conversation ON THIS SAME MAILBOX there is no safe way to merge the two
 * threads' messages into one row. That case is rejected with a clear,
 * actionable error rather than silently duplicating or losing anything.
 * Account-aware (not "any EMAIL conversation") on purpose: a contact can
 * now legitimately have one EMAIL conversation per connected mailbox (see
 * imapSync.ts's resolveConversation), so linking a Webmail thread to a
 * contact who already has a separate Gmail thread is allowed — only a
 * second conversation on the SAME mailbox is a genuine, unmergeable
 * duplicate. */
export async function linkConversationToContact(conversationId: string, contactId: string) {
  const conversation = await conversationsRepo.findById(conversationId);
  if (!conversation) throw new UnauthorizedError("Conversation not found.");
  await assertCompanyAccess(conversation.companyId);
  if (conversation.contactId) throw new Error("This conversation is already linked to a contact.");

  const contactCompanyId = await contactsRepo.findCompanyIdById(contactId);
  if (!contactCompanyId || contactCompanyId !== conversation.companyId) {
    throw new Error("Contact must belong to the same company as this email thread.");
  }

  const existing = await conversationsRepo.findByContactIdChannelAndAccount(contactId, CHANNEL, conversation.companyEmailAccountId);
  if (existing) {
    throw new Error(
      "This contact already has an email conversation on this same mailbox — open it from the Contacts list instead of linking a second thread."
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

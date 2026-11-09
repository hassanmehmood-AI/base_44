import { getDb } from "@/db";
import * as conversationsRepo from "@/server/repositories/conversations";
import * as messagesRepo from "@/server/repositories/messages";
import * as companyEmailAccountsRepo from "@/server/repositories/companyEmailAccounts";
import type { CompanyEmailAccount } from "@/server/repositories/companyEmailAccounts";
import * as contactsRepo from "@/server/repositories/contacts";
import * as imapProvider from "@/server/integrations/imap";
import { ImapConnectionError } from "@/server/integrations/imap";
import { getPassword } from "@/server/services/smtpOnboarding";
import { sanitizeEmailHtml } from "@/lib/emailHtml";
import { validateAttachment } from "@/lib/emailAttachments";
import * as attachmentStorage from "@/server/integrations/emailAttachmentStorage";
import type { StoredEmailAttachment } from "@/lib/emailAttachments";

const CHANNEL = "EMAIL";

/** Universal webmail inbound sync — the IMAP equivalent of gmailSync.ts,
 * deliberately a fully separate, standalone file rather than a shared
 * abstraction: this codebase's own established convention (whatsapp.ts,
 * social.ts, and gmailSync.ts are already independent siblings, not a
 * shared "channel sync" base class) and, more importantly, the explicit
 * requirement that the Gmail integration never be touched — nothing here
 * imports from or modifies gmailSync.ts, and gmailSync.ts has zero
 * awareness this file exists. Scope: INBOX only (see integrations/imap.ts's
 * module doc comment for why "Sent" isn't scanned). */

function resolveSmtpImapConfig(account: CompanyEmailAccount) {
  if (!account.imapHost || !account.imapPort || !account.imapSecurity || !account.smtpImapUsername) {
    throw new Error(`Account ${account.id} is missing IMAP connection details.`);
  }
  return {
    host: account.imapHost,
    port: account.imapPort,
    security: account.imapSecurity as "SSL" | "STARTTLS" | "NONE",
    username: account.smtpImapUsername,
    password: getPassword(account),
  };
}

/** Pure, exported-for-tests resolver — same "contact match, else Unassigned
 * Inbox" design as gmailSync.ts's own resolveConversation, duplicated here
 * rather than shared (see module doc comment). One real difference from
 * Gmail: IMAP has no native thread-id concept, so the Unassigned fallback
 * groups by the sender's own email address instead of a provider thread id
 * — the natural equivalent for a generic inbox ("every message from this
 * unknown sender is the same conversation until it's linked to a contact").
 *
 * A second, deliberate difference from Gmail's own resolver: the
 * contact-match branch is account-aware (findByContactIdChannelAndAccount,
 * not findByContactIdAndChannel) — a contact can now have one EMAIL
 * conversation per connected company mailbox that's actually exchanged mail
 * with them (e.g. one thread for their Gmail history, a separate thread for
 * their Webmail history), each permanently bound to its own mailbox for
 * replies. Gmail's own resolver intentionally keeps rolling a contact's
 * entire history into one thread — that stays true for Gmail-only contacts;
 * this only changes what happens once a SECOND mailbox is also involved. */
async function resolveConversation(
  account: CompanyEmailAccount,
  message: imapProvider.ImapMessage,
  counterpartEmail: string | null
): Promise<{ conversationId: string; contactId: string | null }> {
  if (counterpartEmail) {
    const contact = await contactsRepo.findByEmail(account.companyId, counterpartEmail);
    if (contact) {
      // Account-aware on purpose: a contact who already has a conversation
      // on a DIFFERENT connected mailbox (e.g. their history is with this
      // company's Gmail account) must get a separate thread here, not have
      // this message folded into that other mailbox's conversation — see
      // this function's module doc comment and conversations.ts's
      // findByContactIdChannelAndAccount for why.
      const existing = await conversationsRepo.findByContactIdChannelAndAccount(contact.id, CHANNEL, account.id);
      if (existing) return { conversationId: existing.id, contactId: contact.id };
      const created = await conversationsRepo.create({
        companyId: account.companyId,
        contactId: contact.id,
        channel: CHANNEL,
        subject: message.subject,
        companyEmailAccountId: account.id,
      });
      return { conversationId: created.id, contactId: contact.id };
    }

    const existingUnassigned = await conversationsRepo.findByExternalThreadId(account.companyId, CHANNEL, counterpartEmail);
    if (existingUnassigned) return { conversationId: existingUnassigned.id, contactId: existingUnassigned.contactId };
    const created = await conversationsRepo.create({
      companyId: account.companyId,
      channel: CHANNEL,
      externalThreadId: counterpartEmail,
      subject: message.subject,
      companyEmailAccountId: account.id,
    });
    return { conversationId: created.id, contactId: null };
  }

  // No usable sender address at all (rare, malformed mail) — one
  // conversation per account for anything this ungrouped, rather than
  // silently dropping the message.
  const fallbackKey = `unknown-sender:${account.id}`;
  const existingUnassigned = await conversationsRepo.findByExternalThreadId(account.companyId, CHANNEL, fallbackKey);
  if (existingUnassigned) return { conversationId: existingUnassigned.id, contactId: existingUnassigned.contactId };
  const created = await conversationsRepo.create({
    companyId: account.companyId,
    channel: CHANNEL,
    externalThreadId: fallbackKey,
    subject: message.subject,
    companyEmailAccountId: account.id,
  });
  return { conversationId: created.id, contactId: null };
}

/** Same best-effort-per-attachment philosophy as gmailSync.ts's
 * downloadAndStoreAttachments — one bad/oversized attachment is skipped
 * and logged, never allowed to fail the whole message. Unlike Gmail
 * (separate attachmentId + getAttachment call), IMAP/mailparser already
 * hands over the raw bytes directly in the fetched message, so there's no
 * second network round-trip needed here. */
async function storeAttachments(account: CompanyEmailAccount, batchId: string, attachments: imapProvider.ImapAttachment[]): Promise<StoredEmailAttachment[]> {
  if (attachments.length === 0) return [];
  if (!attachmentStorage.isAttachmentStorageConfigured()) {
    console.warn(`[imap sync] message has ${attachments.length} attachment(s) but attachment storage isn't configured — skipping.`);
    return [];
  }

  const stored: StoredEmailAttachment[] = [];
  for (const [index, att] of attachments.entries()) {
    const validationError = validateAttachment(att.mimeType, att.size);
    if (validationError) {
      console.warn(`[imap sync] skipping attachment "${att.filename}": ${validationError}`);
      continue;
    }
    try {
      const key = attachmentStorage.buildAttachmentKey(account.companyId, batchId, index, att.filename);
      await attachmentStorage.putAttachment(key, att.content, att.mimeType);
      stored.push({ filename: att.filename, mimeType: att.mimeType, size: att.size, key });
    } catch (e) {
      console.error(`[imap sync] failed to store attachment "${att.filename}":`, e instanceof Error ? e.message : e);
    }
  }
  return stored;
}

async function processOneMessage(account: CompanyEmailAccount, message: imapProvider.ImapMessage): Promise<void> {
  const counterpartEmail = message.from.email ? message.from.email.trim().toLowerCase() : null;
  const { conversationId } = await resolveConversation(account, message, counterpartEmail);

  // Idempotency: same convention as gmailSync.ts/whatsapp.ts — check
  // metadata.externalId before inserting, so a re-run after a crash (e.g.
  // between fetching this message and advancing the uid cursor) can never
  // create a duplicate row. Falls back to a uid-scoped key when the
  // message has no Message-ID header (see ImapMessage's own doc comment).
  const dedupeKey = message.messageId ?? `imap-uid:${account.id}:${message.uid}`;
  const existing = await messagesRepo.findByConversationId(conversationId);
  const alreadyStored = existing.some((m) => (m.metadata as { externalId?: string } | null)?.externalId === dedupeKey);
  if (alreadyStored) return;

  const safeHtml = message.bodyHtml ? sanitizeEmailHtml(message.bodyHtml) : null;
  const storedAttachments = await storeAttachments(account, String(message.uid), message.attachments);

  const metadata: Record<string, unknown> = { externalId: dedupeKey };
  if (counterpartEmail) metadata.senderEmail = counterpartEmail;
  if (safeHtml) metadata.bodyHtml = safeHtml;
  if (storedAttachments.length > 0) metadata.attachments = storedAttachments;

  await messagesRepo.create({
    conversationId,
    direction: "INBOUND",
    senderLabel: message.from.name,
    body: message.body,
    metadata,
    sentAt: message.internalDate,
  });
  await conversationsRepo.updateLastMessageAt(conversationId, message.internalDate);
}

/** The IMAP equivalent of gmailSync.ts's processHistoryForAccount. Same
 * "never backfill" guarantee for a BRAND-NEW connection: the baseline is
 * already set at connect time (see smtpOnboarding.ts's connectAccount), so
 * the very first sync tick only ever sees uid > that baseline — mail that
 * existed before connecting is never imported. A UIDVALIDITY mismatch on an
 * ALREADY-connected account is handled differently, on purpose: the old
 * cursor is meaningless under the server's new numbering, so the mailbox is
 * re-scanned from the start rather than fast-forwarded past — see the
 * uidValidityChanged branch below for why skipping instead would silently
 * and permanently lose mail. */
export async function processInboxForAccount(account: CompanyEmailAccount): Promise<void> {
  const config = resolveSmtpImapConfig(account);

  if (!account.imapUidValidity || !account.imapLastSeenUid) {
    const baseline = await imapProvider.getMailboxUidValidity(config);
    await companyEmailAccountsRepo.updateImapSyncState(account.id, { imapUidValidity: baseline.uidValidity, imapLastSeenUid: baseline.lastUid });
    return;
  }

  const current = await imapProvider.getMailboxUidValidity(config);
  const uidValidityChanged = current.uidValidity !== account.imapUidValidity;
  if (uidValidityChanged) {
    // The server's UID numbering was reset, so the stored cursor no longer
    // means anything under the new numbering — but unlike the brand-new
    // connection case above, this is NOT a "never backfill" situation.
    // Fast-forwarding straight to current.lastUid (the old behavior) would
    // silently and PERMANENTLY drop any mail that arrived right around the
    // reset, since the cursor would already be past it on every future
    // tick. Instead, re-scan the whole mailbox from the start: this is
    // safe because processOneMessage's own per-conversation dedupe is
    // keyed by Message-ID (not UID), so anything already stored is simply
    // skipped rather than re-imported — only genuinely-missed mail ends up
    // creating a new message.
    console.warn(`[imap sync] UIDVALIDITY changed for account ${account.id} — re-scanning the mailbox from the start (dedup prevents re-importing already-synced mail).`);
  }
  const afterUid = uidValidityChanged ? 0 : Number(account.imapLastSeenUid);
  const messages = await imapProvider.fetchNewMessages(config, afterUid);

  let highestUid = afterUid;
  for (const message of messages) {
    await processOneMessage(account, message);
    if (message.uid > highestUid) highestUid = message.uid;
  }

  if (uidValidityChanged || highestUid > afterUid) {
    await companyEmailAccountsRepo.updateImapSyncState(account.id, {
      imapUidValidity: current.uidValidity,
      imapLastSeenUid: String(Math.max(highestUid, Number(current.lastUid))),
    });
  }
}

const IMAP_SYNC_ADVISORY_LOCK_KEY = 918273645; // distinct from gmailSync.ts's 847234651 and social.ts's 7294051990

export type ImapSyncSweepResult =
  | { accountsChecked: number; accountsFailed: number; skippedConcurrent?: false }
  | { accountsChecked: 0; accountsFailed: 0; skippedConcurrent: true };

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const rateLimitedUntil = new Map<string, number>();

/** The IMAP equivalent of gmailSync.ts's syncAllActiveAccounts — same
 * advisory-lock-protected sweep shape, same per-account backoff on a
 * repeated failure (IMAP has no formal "rate limit" response code like
 * Gmail's 429, so this backs off on ANY connection error, not just a
 * specific status — a misbehaving/unreachable server gets the same
 * breathing room a rate-limited one would). Only ever queries
 * provider = 'SMTP_IMAP' rows — Google accounts are invisible to this
 * function entirely. */
export async function syncAllActiveImapAccounts(): Promise<ImapSyncSweepResult> {
  const db = getDb();

  return db.$client.begin(async (tx) => {
    const rows = await tx`SELECT pg_try_advisory_xact_lock(${IMAP_SYNC_ADVISORY_LOCK_KEY}) AS locked`;
    if (!rows[0].locked) {
      return { accountsChecked: 0, accountsFailed: 0, skippedConcurrent: true as const };
    }

    const allActive = await companyEmailAccountsRepo.findAllActive();
    const accounts = allActive.filter((a) => a.provider === "SMTP_IMAP");
    let accountsFailed = 0;

    for (const account of accounts) {
      const cooldownUntil = rateLimitedUntil.get(account.id);
      if (cooldownUntil && Date.now() < cooldownUntil) continue;

      try {
        await processInboxForAccount(account);
        rateLimitedUntil.delete(account.id);
      } catch (e) {
        accountsFailed++;
        if (e instanceof ImapConnectionError) {
          rateLimitedUntil.set(account.id, Date.now() + RATE_LIMIT_COOLDOWN_MS);
          console.warn(`[imap sync] account ${account.id} connection failed — backing off ${RATE_LIMIT_COOLDOWN_MS / 1000}s: ${e.message}`);
        } else {
          console.error(`[imap sync] sweep failed for account ${account.id}:`, e instanceof Error ? e.message : e);
        }
      }
    }

    return { accountsChecked: accounts.length, accountsFailed };
  });
}

import { getDb } from "@/db";
import * as conversationsRepo from "@/server/repositories/conversations";
import * as messagesRepo from "@/server/repositories/messages";
import * as companySocialAccountsRepo from "@/server/repositories/companySocialAccounts";
import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as companiesService from "@/server/services/companies";
import { assertAssignableUser } from "@/server/services/users";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import * as metaProvider from "@/server/integrations/meta";
import * as metricoolProvider from "@/server/integrations/metricool";
import type { CompanySocialAccount } from "@/server/repositories/companySocialAccounts";

const CHANNEL = "SOCIAL";

const METRICOOL_PLATFORMS = ["METRICOOL_INSTAGRAM", "METRICOOL_FACEBOOK"] as const;

function metricoolProviderForPlatform(platform: string): metricoolProvider.MetricoolProvider {
  return platform === "METRICOOL_FACEBOOK" ? "FACEBOOK" : "INSTAGRAM";
}

export async function listSocialConversationsForCurrentUser() {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  const conversations = await conversationsRepo.findManyByCompanyIdsAndChannel(allowed.map((c) => c.id), CHANNEL);
  return enrichWithFreshAvatars(conversations);
}

/** How long enrichment waits per connected account before giving up on that
 * account and falling back to whatever's already stored. This is a "soft"
 * timeout (Promise.race, not an AbortController) because listConversations/
 * metricoolFetch (integrations/metricool.ts) don't accept a cancellation
 * signal today, and threading one through would mean changing a function
 * shared with the existing sync and reply flows — out of scope here. The
 * already-in-flight fetch keeps running in the background either way; this
 * only stops *this request's render* from waiting on it, which is what
 * actually matters for page latency. 4s keeps worst case bounded (all
 * accounts are queried in parallel, so this is the total added delay
 * regardless of how many accounts there are) while comfortably exceeding the
 * sub-second responses seen in normal operation. */
const AVATAR_ENRICHMENT_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Page-view-time avatar refresh — deliberately separate from (and never
 * called by) syncMetricoolConversations/the cron route, so the message-sync
 * flow and its schedule are completely untouched. Metricool's
 * imageProfileUrl is a signed, short-lived Facebook Graph API URL (confirmed
 * live: one expired within a few hours of being issued — see commit
 * 8bde953's Avatar fix), so whatever value the regular 5-minute sync last
 * persisted is frequently already dead by the time a person actually opens
 * this page. This re-fetches a live value right when it's needed for
 * display instead.
 *
 * Grouped by companySocialAccountId so each distinct connected account is
 * queried at most once no matter how many of its conversations are being
 * shown — never once per customer/row — and all accounts are queried in
 * parallel, so this adds at most ~AVATAR_ENRICHMENT_TIMEOUT_MS to a page
 * load regardless of how many connected accounts there are. Best-effort and
 * side-effect-free: a Metricool failure OR timeout for one account is
 * swallowed and that account's conversations are simply left on whatever
 * customerAvatarUrl was already stored (itself already null-safe — the
 * Avatar component already falls back to initials for a null or a dead URL).
 * Nothing is written back to the database here; this only shapes what's
 * returned to the caller for rendering. */
async function enrichWithFreshAvatars<
  T extends { id: string; customerAvatarUrl: string | null; companySocialAccountId: string | null; externalThreadId: string | null },
>(conversations: T[]): Promise<T[]> {
  const accountIds = [
    ...new Set(conversations.map((c) => c.companySocialAccountId).filter((id): id is string => Boolean(id))),
  ];
  if (accountIds.length === 0) return conversations;

  const freshAvatarByConversationId = new Map<string, string>();

  await Promise.all(
    accountIds.map(async (accountId) => {
      try {
        const account = await companySocialAccountsRepo.findById(accountId);
        if (!account || !(METRICOOL_PLATFORMS as readonly string[]).includes(account.platform)) return;

        const provider = metricoolProviderForPlatform(account.platform);
        const remoteConversations = await withTimeout(
          metricoolProvider.listConversations(account.externalPageId, provider),
          AVATAR_ENRICHMENT_TIMEOUT_MS
        );
        const remoteByThreadId = new Map(remoteConversations.map((r) => [r.id, r]));

        for (const c of conversations) {
          if (c.companySocialAccountId !== accountId || !c.externalThreadId) continue;
          const remote = remoteByThreadId.get(c.externalThreadId);
          const otherParticipant = remote?.participants.find((p) => p.id !== remote.self);
          if (otherParticipant?.imageProfileUrl) {
            freshAvatarByConversationId.set(c.id, otherParticipant.imageProfileUrl);
          }
        }
      } catch {
        // Best-effort only — this account's conversations keep whatever
        // customerAvatarUrl was already stored (or null, which the Avatar
        // component already renders as initials).
      }
    })
  );

  if (freshAvatarByConversationId.size === 0) return conversations;
  return conversations.map((c) =>
    freshAvatarByConversationId.has(c.id)
      ? { ...c, customerAvatarUrl: freshAvatarByConversationId.get(c.id)! }
      : c
  );
}

const FACEBOOK_PLATFORMS = ["META_PAGE", "METRICOOL_FACEBOOK"];
const INSTAGRAM_PLATFORMS_LIST = ["META_INSTAGRAM", "METRICOOL_INSTAGRAM"];

export type PlatformConnectionStatus = { facebookConnected: boolean; instagramConnected: boolean };

/** Per-company "is this platform tab actually usable" signal for the Social
 * Media page — keyed by company name (matching the page's existing,
 * name-keyed company filter, see RedesSocialesClient). A row existing in
 * company_social_accounts isn't enough on its own for a Metricool-backed
 * platform: a brand can have a network provisioned in this CRM's DB without
 * ever actually being linked on Metricool's side (confirmed live — Web
 * Nova's Instagram row exists but Metricool's own networksData shows it
 * unconnected; see metricoolOnboarding.ts's identical check). Direct Meta
 * accounts (META_PAGE/META_INSTAGRAM) have no such gap — their OAuth flow
 * only ever creates the row once truly connected — so those are trusted from
 * presence alone, no live call needed.
 *
 * Metricool lookups are deduped per distinct blogId (a brand's Facebook and
 * Instagram rows share one) and degrade to "not connected" on any Metricool
 * error (not configured, outage, etc.) rather than failing the page — this
 * is a page-load nicety for the tab empty-state, not the authoritative
 * provisioning check (that remains Configuración's live "check status"). */
export async function getPlatformConnectionStatusForCurrentUser(): Promise<Record<string, PlatformConnectionStatus>> {
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  const accounts = await companySocialAccountsRepo.findByCompanyIds(allowed.map((c) => c.id));

  const brandCache = new Map<string, Promise<metricoolProvider.MetricoolBrand | null>>();
  function brandFor(blogId: string) {
    let pending = brandCache.get(blogId);
    if (!pending) {
      pending = metricoolProvider.getBrand(blogId).catch(() => null);
      brandCache.set(blogId, pending);
    }
    return pending;
  }

  const result: Record<string, PlatformConnectionStatus> = {};
  for (const company of allowed) {
    const rows = accounts.filter((a) => a.companyId === company.id);
    const fb = rows.find((r) => FACEBOOK_PLATFORMS.includes(r.platform));
    const ig = rows.find((r) => INSTAGRAM_PLATFORMS_LIST.includes(r.platform));

    const facebookConnected = fb
      ? fb.platform === "METRICOOL_FACEBOOK"
        ? Boolean((await brandFor(fb.externalPageId))?.networksData?.facebookData)
        : true
      : false;
    const instagramConnected = ig
      ? ig.platform === "METRICOOL_INSTAGRAM"
        ? Boolean((await brandFor(ig.externalPageId))?.networksData?.instagramData)
        : true
      : false;

    result[company.name] = { facebookConnected, instagramConnected };
  }
  return result;
}

export async function getConversation(id: string) {
  const conversation = await conversationsRepo.findById(id);
  if (!conversation) return undefined;
  await assertCompanyAccess(conversation.companyId);
  const messages = await messagesRepo.findByConversationId(id);
  // Same page-view-time enrichment as the list (see enrichWithFreshAvatars) —
  // without this, opening a conversation would revert its avatar from the
  // freshly-enriched list value back to whatever's stored, since this reads
  // straight from the DB above.
  const [enriched] = await enrichWithFreshAvatars([conversation]);
  return { conversation: enriched, messages };
}

export async function replyToConversation(conversationId: string, body: string) {
  const session = await requireSession();
  const conversation = await conversationsRepo.findById(conversationId);
  if (!conversation) throw new UnauthorizedError("Conversation not found.");
  await assertCompanyAccess(conversation.companyId);
  if (!conversation.externalThreadId) throw new Error("This conversation has no external sender id to reply to.");

  // Conversations created before companySocialAccountId existed (or created
  // by the Meta webhook, which never sets it) fall through to the original
  // direct-Meta-Graph-API send — existing Meta behavior is unchanged. Only
  // conversations explicitly linked to a METRICOOL_* account route through
  // Metricool instead.
  const account = conversation.companySocialAccountId
    ? await companySocialAccountsRepo.findById(conversation.companySocialAccountId)
    : undefined;

  // Metricool-assigned id for this exact send, captured so the next poll
  // (syncMetricoolConversations) recognizes this message as already-stored
  // instead of re-inserting it as a new, mislabeled INBOUND message — see
  // that function's seenExternalIds check. Meta-direct sends have no
  // equivalent polling step (Meta pushes inbound messages via webhook
  // instead), so there's nothing to dedupe against and no id to capture.
  let externalId: string | undefined;
  if (account && (METRICOOL_PLATFORMS as readonly string[]).includes(account.platform)) {
    externalId = await sendViaMetricool(account, conversation.externalThreadId, body);
  } else {
    await metaProvider.sendMessage(conversation.externalThreadId, body);
  }

  const now = new Date();
  await messagesRepo.create({
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderLabel: session.user.name,
    body,
    createdBy: session.user.id,
    sentAt: now,
    metadata: externalId ? { externalId } : null,
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

/** Resolves who to reply to by re-fetching the conversation from Metricool
 * rather than storing a participant id locally — avoids a schema change for
 * one field only needed at send time. Confirmed against a live payload:
 * `participants` always includes the connected brand's own account alongside
 * the contact (brand first in every observed conversation) — picking
 * `participants[0]` unconditionally was sending every reply addressed to the
 * brand's own account, which Metricool correctly rejects with a 400. The
 * contact is whichever participant's id isn't the conversation's own `self`. */
async function sendViaMetricool(account: CompanySocialAccount, externalThreadId: string, body: string): Promise<string> {
  const provider = metricoolProviderForPlatform(account.platform);
  const remoteConversations = await metricoolProvider.listConversations(account.externalPageId, provider);
  const remote = remoteConversations.find((c) => c.id === externalThreadId);
  if (!remote) throw new Error("Conversation not found in Metricool — it may have been removed or expired.");

  const recipient = remote.participants.find((p) => p.id !== remote.self)?.id;
  if (!recipient) throw new Error("Could not determine who to reply to for this Metricool conversation.");

  return metricoolProvider.sendMessage(account.externalPageId, provider, externalThreadId, recipient, body);
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
  await assertAssignableUser(assignedUserId);
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

/** Metricool poll-sync entry point — Metricool's Inbox has no webhook (its
 * own docs say messages must be checked manually/polled), so this is called
 * on an interval per connected account by the cron route instead of being
 * pushed to like ingestInboundMessage above. Same no-session model: trust
 * comes from `account` being a row already registered in
 * company_social_accounts, never from caller-supplied input.
 *
 * Mirrors ingestInboundMessage's scope exactly — find-or-create the
 * conversation, append new messages, bump lastMessageAt — and deliberately
 * does NOT log an activity per inbound message, matching how the Meta
 * webhook path doesn't either (an activity is only ever logged when an
 * agent replies, see replyToConversation above).
 *
 * Idempotent and safe to re-run on every poll tick: new messages are
 * deduped against what's already stored via Metricool's own message id,
 * kept in messages.metadata.externalId — including messages this same
 * reply flow already wrote at send time, so a message sent through this CRM
 * is never double-inserted when it shows back up in the next poll.
 *
 * Conversations are matched by (companyId, channel, externalThreadId =
 * Metricool's conversation id) — a completely different id space from
 * Meta's PSID-keyed conversations, so there's no possibility of a Metricool
 * sync colliding with an existing Meta-sourced conversation row.
 *
 * Also reconciles subject/customerAvatarUrl on every poll (see the identity
 * fix below) — this is how existing conversations synced before the
 * remote.self fix get corrected, without a separate migration/backfill
 * script: every connected account's conversations pass through here on the
 * existing 5-minute schedule already. */
export async function syncMetricoolConversations(account: {
  id: string;
  companyId: string;
  platform: string;
  externalPageId: string;
}): Promise<{ conversationsSeen: number; messagesAdded: number; skipped?: true }> {
  const provider = metricoolProviderForPlatform(account.platform);

  // Both platform rows for a company share one Metricool brand (see
  // linkBrandRows in metricoolOnboarding.ts), but a brand often only has one
  // network actually connected — confirmed live: calling listConversations
  // for a provider with no connection on the brand 500s instead of returning
  // an empty list. Skip those up front rather than letting them error on
  // every poll tick.
  const brand = await metricoolProvider.getBrand(account.externalPageId);
  const connected =
    provider === "FACEBOOK" ? Boolean(brand.networksData?.facebookData) : Boolean(brand.networksData?.instagramData);
  if (!connected) {
    return { conversationsSeen: 0, messagesAdded: 0, skipped: true };
  }

  const remoteConversations = await metricoolProvider.listConversations(account.externalPageId, provider);

  let messagesAdded = 0;

  for (const remote of remoteConversations) {
    const otherParticipant = remote.participants.find((p) => p.id !== remote.self) ?? remote.participants[0];

    let conversation = await conversationsRepo.findByExternalThreadId(account.companyId, CHANNEL, remote.id);
    if (!conversation) {
      conversation = await conversationsRepo.create({
        companyId: account.companyId,
        channel: CHANNEL,
        externalThreadId: remote.id,
        subject: otherParticipant?.name ?? null,
        customerAvatarUrl: otherParticipant?.imageProfileUrl ?? null,
        companySocialAccountId: account.id,
      });
    } else {
      // Reconciliation for conversations synced before the remote.self
      // participant fix existed (they were created with subject set to the
      // connected brand's own name, e.g. "Web Nova", instead of the actual
      // contact's). Safe to re-run every poll tick: only writes when the
      // freshly-resolved value is non-empty AND different from what's
      // already stored, so a transient/incomplete Metricool response can
      // never blank out a previously-correct name or picture.
      const nextSubject = otherParticipant?.name || null;
      const nextAvatarUrl = otherParticipant?.imageProfileUrl || null;
      const needsSubjectFix = Boolean(nextSubject) && nextSubject !== conversation.subject;
      const needsAvatarFix = Boolean(nextAvatarUrl) && nextAvatarUrl !== conversation.customerAvatarUrl;
      if (needsSubjectFix || needsAvatarFix) {
        conversation = await conversationsRepo.updateIdentity(conversation.id, {
          subject: needsSubjectFix ? nextSubject : conversation.subject,
          customerAvatarUrl: needsAvatarFix ? nextAvatarUrl : conversation.customerAvatarUrl,
        });
      }
    }

    const existing = await messagesRepo.findByConversationId(conversation.id);
    const seenExternalIds = new Set(
      existing.map((m) => (m.metadata as { externalId?: string } | null)?.externalId).filter((id): id is string => Boolean(id))
    );

    const newRemoteMessages = selectUnseenRemoteMessages(remote.messages, seenExternalIds);
    if (newRemoteMessages.length === 0) continue;

    let latestSentAt: Date | null = null;
    for (const m of newRemoteMessages) {
      const sentAt = new Date(m.publicationDateTime);
      // Direction is derived from the verified sender id (m.from vs. the
      // conversation's own `remote.self`), never assumed. Genuine outbound
      // replies sent through this CRM are already written at send time (with
      // their Metricool-assigned id — see sendViaMetricool/replyToConversation)
      // so they're already in seenExternalIds above and never reach this
      // branch; this check instead covers a reply sent from Metricool's own
      // web UI (bypassing this CRM) and acts as a defense-in-depth backstop
      // against mislabeling if that id capture ever fails for any reason.
      const direction = resolveSyncedMessageDirection(m.from, remote.self);
      const senderLabel = direction === "OUTBOUND" ? null : remote.participants.find((p) => p.id === m.from)?.name ?? null;
      await messagesRepo.create({
        conversationId: conversation.id,
        direction,
        senderLabel,
        body: m.text,
        metadata: { externalId: m.id },
        sentAt,
      });
      messagesAdded += 1;
      latestSentAt = sentAt;
    }

    if (latestSentAt) {
      await conversationsRepo.updateLastMessageAt(conversation.id, latestSentAt);
    }
  }

  return { conversationsSeen: remoteConversations.length, messagesAdded };
}

/** Pure sync helpers, exported only so the regression tests (social.test.ts)
 * can exercise them directly without standing up a database. */

/** A remote message is OUTBOUND only when its verified sender id matches the
 * conversation's own `self` participant — never inferred from array
 * position, message text, or display name. */
export function resolveSyncedMessageDirection(
  senderId: string,
  selfId: string
): "INBOUND" | "OUTBOUND" {
  return senderId === selfId ? "OUTBOUND" : "INBOUND";
}

/** Dedupes by Metricool's own per-message id (never by body text — customers
 * can legitimately send the same text twice), then orders chronologically so
 * callers persist history in the right sequence. */
export function selectUnseenRemoteMessages<T extends { id: string; publicationDateTime: string }>(
  remoteMessages: T[],
  seenExternalIds: Set<string>
): T[] {
  return remoteMessages
    .filter((m) => !seenExternalIds.has(m.id))
    .sort((a, b) => new Date(a.publicationDateTime).getTime() - new Date(b.publicationDateTime).getTime());
}

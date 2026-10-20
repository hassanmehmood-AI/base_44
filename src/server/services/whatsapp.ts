import { timingSafeEqual } from "node:crypto";
import * as conversationsRepo from "@/server/repositories/conversations";
import * as messagesRepo from "@/server/repositories/messages";
import * as whapiChannelsRepo from "@/server/repositories/whapiChannels";
import * as whapiInboundEventsRepo from "@/server/repositories/whapiInboundEvents";
import type { WhapiChannel } from "@/server/repositories/whapiChannels";
import * as whapiProvider from "@/server/integrations/whapi";
import * as avatarCapture from "@/server/services/avatarCapture";
import { decryptSecret } from "@/server/crypto/secretBox";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import { getAllowedCompaniesForCurrentUser } from "@/server/services/companies";

const CHANNEL = "WHATSAPP";

/** WhatsApp (Whapi.Cloud) conversations/messages — the WhatsApp equivalent
 * of services/social.ts, split into its own file because the two channels'
 * provider integrations, webhook formats, and credential models are
 * unrelated (see whapiOnboarding.ts's doc comment on the one structural
 * difference: a per-company secret token rather than Metricool's single
 * shared account token). Nothing here is called by, or changes the
 * behavior of, social.ts or the Metricool sync cron. This file DOES call
 * into avatarCapture.ts's existing, already-channel-agnostic queue (see
 * maybeFetchAndQueueAvatarIfNeeded below) — but only ever as a caller
 * passing a fresh WhatsApp-sourced url; avatarCapture.ts's own queueing,
 * retry-capping, and download logic is untouched, so Metricool/Meta's
 * existing avatar behavior is unaffected. */

export type IncomingWhapiMessage = {
  id: string;
  from_me?: boolean;
  type?: string;
  chat_id: string;
  timestamp?: number;
  text?: { body?: string };
  from?: string;
  from_name?: string;
};

export type IncomingWhapiPayload = {
  messages?: IncomingWhapiMessage[];
  channel_id?: string;
};

/** Constant-time comparison for the webhook's shared-secret header — the
 * compensating control for Whapi's lack of native webhook signing (see
 * integrations/whapi.ts's module doc comment and db/schema.ts's
 * whapiChannels comment). Returns false (never throws) on any length
 * mismatch so a malformed/missing header is just "not authentic," not a
 * crash. */
export function verifyWebhookSecret(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/** Resolves which provisioned, ACTIVE channel a webhook call is for, and
 * verifies the request's secret header against that channel's own stored
 * secret — never a single global secret, so one company's channel being
 * compromised can't be used to forge events for another company's channel.
 * Returns undefined for any unknown/inactive channel OR a bad secret —
 * callers must reject the request without distinguishing the two reasons in
 * the HTTP response (never confirm to a caller whether a given channel_id
 * exists). */
export async function resolveAuthenticatedChannel(channelId: string | undefined, providedSecret: string | null): Promise<WhapiChannel | undefined> {
  if (!channelId) return undefined;
  const channel = await whapiChannelsRepo.findByChannelId(channelId);
  if (!channel || channel.status !== "ACTIVE" || !channel.encryptedWebhookSecret) return undefined;
  const expected = decryptSecret(channel.encryptedWebhookSecret);
  return verifyWebhookSecret(expected, providedSecret) ? channel : undefined;
}

/** The webhook route's ONLY job for each inbound message: get it durably
 * staged as fast as possible (see whapi_inbound_events' doc comment in
 * db/schema.ts) before attempting anything else. A duplicate delivery of a
 * message already staged is a harmless no-op (the unique index on
 * (whapiChannelId, externalMessageId) absorbs it) — detected here via the
 * unique-violation error code so the caller never has to special-case it. */
export async function stagePendingEvents(channel: WhapiChannel, payload: IncomingWhapiPayload): Promise<{ staged: number; duplicates: number }> {
  let staged = 0;
  let duplicates = 0;
  for (const message of payload.messages ?? []) {
    if (!message.id) continue;
    try {
      await whapiInboundEventsRepo.insertPending(channel.id, message.id, message);
      staged++;
    } catch (e) {
      if (isUniqueViolation(e)) {
        duplicates++;
        continue;
      }
      throw e;
    }
  }
  return { staged, duplicates };
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}

const MAX_PROCESS_ATTEMPTS = 5;

/** Turns durably-staged events into real conversations/messages — safe to
 * call repeatedly and from multiple overlapping triggers (the webhook
 * route's own after() dispatch, and the dedicated sweep cron for anything
 * left over from a crash — see api/cron/whapi-process-pending/route.ts):
 * whapiInboundEventsRepo.claim's conditional UPDATE means only one caller
 * ever successfully claims a given PENDING row.
 *
 * Idempotency has two independent layers, same proven approach as
 * services/social.ts's Metricool sync: (1) the staging insert's unique
 * index already prevented a duplicate row from ever existing, and (2) this
 * function also checks messages.metadata.externalId before inserting, so
 * even a staged-twice-somehow event (or a hand-run reprocessing) can never
 * create two message rows for the same WhatsApp message. */
export async function processPendingWhapiEvents(limit = 25): Promise<{ attempted: number; processed: number; abandoned: number; failed: number }> {
  const pending = await whapiInboundEventsRepo.findPending(limit);
  let processed = 0;
  let abandoned = 0;
  let failed = 0;

  for (const candidate of pending) {
    const claimed = await whapiInboundEventsRepo.claim(candidate.id);
    if (!claimed) continue; // another caller already claimed/resolved it

    try {
      await processOneEvent(claimed);
      await whapiInboundEventsRepo.markProcessed(claimed.id);
      processed++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : "Unknown error.";
      if (claimed.attempts + 1 >= MAX_PROCESS_ATTEMPTS) {
        await whapiInboundEventsRepo.markAbandoned(claimed.id, message);
        abandoned++;
      } else {
        await whapiInboundEventsRepo.recordAttemptFailure(claimed.id, message);
      }
      console.error(`[whapi webhook] failed to process event ${claimed.id} (attempt ${claimed.attempts + 1}):`, e);
    }
  }

  return { attempted: pending.length, processed, abandoned, failed };
}

/** Pure mapping from Whapi's raw webhook message shape to what this CRM
 * stores — exported only so the regression tests (whatsapp.test.ts) can
 * exercise it directly without a database, same idiom as social.ts's
 * exported sync helpers. Direction is derived strictly from the verified
 * `from_me` flag Whapi itself sets (never inferred from text/position),
 * matching the same philosophy as social.ts's resolveSyncedMessageDirection. */
export function mapIncomingMessage(message: IncomingWhapiMessage): { direction: "INBOUND" | "OUTBOUND"; body: string; senderLabel: string | null } {
  const direction = message.from_me ? "OUTBOUND" : "INBOUND";
  const body = message.type === "text" ? message.text?.body ?? "" : `[unsupported message type: ${message.type ?? "unknown"}]`;
  return { direction, body, senderLabel: direction === "INBOUND" ? message.from_name ?? null : null };
}

/** Pure gate deciding whether a live Whapi profile-fetch call is worth
 * making at all — exported so the regression tests can exercise it without
 * a database or network call. Three conditions, all must hold:
 *  - direction === "INBOUND": never fetch for our own outbound echo — we
 *    already know our own brand has no "customer" avatar to speak of.
 *  - no customerAvatarKey yet: a permanently-captured avatar never needs
 *    re-fetching — this is what makes a long-running conversation's 50th
 *    inbound message cost zero extra Whapi calls, not one per message.
 *  - no customerAvatarPendingUrl yet: a capture already queued (awaiting
 *    its background download) must not trigger ANOTHER live profile fetch
 *    for every subsequent inbound message that arrives before that
 *    download completes — this is the difference between one Whapi call
 *    per conversation and one per message. */
export function shouldFetchContactAvatar(
  direction: "INBOUND" | "OUTBOUND",
  conversation: { customerAvatarKey: string | null; customerAvatarPendingUrl: string | null }
): boolean {
  return direction === "INBOUND" && !conversation.customerAvatarKey && !conversation.customerAvatarPendingUrl;
}

/** Best-effort, isolated from message processing by design: every failure
 * mode here (decrypt error, Whapi API error/timeout, a queueing error) is
 * caught and logged, never rethrown — so a Whapi avatar-fetch hiccup can
 * never fail the message insert that already succeeded by the time this is
 * called (see processOneEvent, which calls this strictly after its own
 * messagesRepo.create has already committed). Mirrors the same
 * best-effort philosophy as avatarCapture.maybeQueuePendingCapture itself,
 * one layer up. */
async function maybeFetchAndQueueAvatarIfNeeded(
  channel: WhapiChannel,
  conversation: Parameters<typeof avatarCapture.maybeQueuePendingCapture>[0],
  contactId: string
): Promise<void> {
  if (!channel.apiUrl || !channel.encryptedToken) return;
  try {
    const token = decryptSecret(channel.encryptedToken);
    const profile = await whapiProvider.getContactProfile(channel.apiUrl, token, contactId);
    const imageUrl = profile.iconFull ?? profile.icon;
    await avatarCapture.maybeQueuePendingCapture(conversation, imageUrl);
  } catch (e) {
    console.error(`[whapi avatar] failed to fetch/queue avatar for conversation ${conversation.id}:`, e instanceof Error ? e.message : e);
  }
}

async function processOneEvent(event: whapiInboundEventsRepo.WhapiInboundEvent): Promise<void> {
  const channel = await whapiChannelsRepo.findById(event.whapiChannelId);
  if (!channel) throw new Error(`whapi_channels row ${event.whapiChannelId} no longer exists.`);

  const message = event.rawPayload as IncomingWhapiMessage;
  const { direction, body, senderLabel } = mapIncomingMessage(message);

  let conversation = await conversationsRepo.findByExternalThreadId(channel.companyId, CHANNEL, message.chat_id);
  if (!conversation) {
    conversation = await conversationsRepo.create({
      companyId: channel.companyId,
      channel: CHANNEL,
      externalThreadId: message.chat_id,
      subject: message.from_name ?? null,
      whapiChannelId: channel.id,
    });
  }

  const existing = await messagesRepo.findByConversationId(conversation.id);
  const alreadyStored = existing.some((m) => (m.metadata as { externalId?: string } | null)?.externalId === message.id);
  if (alreadyStored) return; // e.g. the echo of a message this CRM already sent via replyToWhatsappConversation

  const sentAt = message.timestamp ? new Date(message.timestamp * 1000) : new Date();
  await messagesRepo.create({
    conversationId: conversation.id,
    direction,
    senderLabel,
    body,
    metadata: { externalId: message.id },
    sentAt,
  });
  await conversationsRepo.updateLastMessageAt(conversation.id, sentAt);
  // Realtime push is the existing, channel-agnostic Postgres trigger
  // (0009_notify_new_message.sql fires on every messages insert) — nothing
  // new is needed here for the WebSocket side; see useWhatsappRealtime.ts.

  // Avatar fetch+queue happens strictly AFTER the message above has already
  // committed — see maybeFetchAndQueueAvatarIfNeeded's doc comment for why
  // this ordering is what makes a Whapi avatar-fetch failure structurally
  // unable to affect message delivery.
  if (shouldFetchContactAvatar(direction, conversation)) {
    await maybeFetchAndQueueAvatarIfNeeded(channel, conversation, message.from ?? message.chat_id);
  }
}

export async function listWhatsappConversationsForCurrentUser() {
  await requireSession();
  const allowed = await getAllowedCompaniesForCurrentUser();
  return conversationsRepo.findManyByCompanyIdsAndChannel(allowed.map((c) => c.id), CHANNEL);
}

export async function getWhatsappConversation(id: string) {
  const conversation = await conversationsRepo.findById(id);
  if (!conversation) return undefined;
  await assertCompanyAccess(conversation.companyId);
  const messages = await messagesRepo.findByConversationId(id);
  return { conversation, messages };
}

export async function replyToWhatsappConversation(conversationId: string, body: string) {
  const session = await requireSession();
  const conversation = await conversationsRepo.findById(conversationId);
  if (!conversation) throw new UnauthorizedError("Conversation not found.");
  await assertCompanyAccess(conversation.companyId);
  if (!conversation.externalThreadId) throw new Error("This conversation has no WhatsApp chat id to reply to.");
  if (!conversation.whapiChannelId) throw new Error("This conversation isn't linked to a WhatsApp channel.");

  const channel = await whapiChannelsRepo.findById(conversation.whapiChannelId);
  if (!channel || channel.status !== "ACTIVE" || !channel.apiUrl || !channel.encryptedToken) {
    throw new Error("This company's WhatsApp channel isn't active.");
  }

  const token = decryptSecret(channel.encryptedToken);
  const externalId = await whapiProvider.sendTextMessage(channel.apiUrl, token, conversation.externalThreadId, body);

  const now = new Date();
  await messagesRepo.create({
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderLabel: session.user.name,
    body,
    createdBy: session.user.id,
    sentAt: now,
    metadata: { externalId },
  });
  await conversationsRepo.updateLastMessageAt(conversation.id, now);
}

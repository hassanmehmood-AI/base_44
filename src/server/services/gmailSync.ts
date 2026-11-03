import { timingSafeEqual } from "node:crypto";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { getDb } from "@/db";
import * as conversationsRepo from "@/server/repositories/conversations";
import * as messagesRepo from "@/server/repositories/messages";
import * as companyEmailAccountsRepo from "@/server/repositories/companyEmailAccounts";
import type { CompanyEmailAccount } from "@/server/repositories/companyEmailAccounts";
import * as contactsRepo from "@/server/repositories/contacts";
import * as googleProvider from "@/server/integrations/google";
import { GoogleApiError } from "@/server/integrations/google";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";
import { getValidAccessToken } from "@/server/services/emailOnboarding";

const CHANNEL = "EMAIL";

/** Gmail inbound sync — the Gmail equivalent of whatsapp.ts's
 * processOneEvent, triggered by api/webhooks/gmail/route.ts whenever
 * Pub/Sub reports new activity on a connected mailbox.
 *
 * Unlike Whapi (which has no durable server-side cursor of its own, hence
 * whapi_inbound_events + a cron sweep to recover from a crashed/never-
 * launched attempt), Gmail's own historyId is already a durable, resumable
 * position stored on company_email_accounts: re-running this with the same
 * stale historyId (e.g. after a crash before updateSyncState below
 * commits, or a Pub/Sub at-least-once redelivery) just reprocesses the same
 * range, and the per-message metadata.externalId check (same idempotency
 * check whatsapp.ts uses) makes that safe. No separate staging table is
 * needed for this channel.
 *
 * Watch renewal and missed-notification recovery: see syncAllActiveAccounts
 * below, the cron entrypoint (api/cron/gmail-sync/route.ts) that calls this
 * function proactively for every ACTIVE mailbox on a short interval — not
 * just reactively from the Pub/Sub webhook — so a silently-dropped push
 * notification is still caught within one cron tick.
 *
 * Works identically whether push notifications are configured or not (see
 * establishHistoryBaseline below) — this is what lets local dev polling
 * (scripts/dev-gmail-poll.ts) reuse this exact function, unmodified, as the
 * same code path production's Pub/Sub-triggered sync and cron sweep use. */
export async function processHistoryForAccount(account: CompanyEmailAccount): Promise<void> {
  const accessToken = await getValidAccessToken(account);

  if (!account.historyId) {
    // No cursor yet — establish one from Gmail's current position and stop
    // here. Deliberately never backfills: the next tick's listHistory call
    // starts from this exact historyId, so anything that existed in the
    // mailbox BEFORE this moment is never imported, only mail that arrives
    // from here on — the explicit "sync only new messages" requirement.
    const baseline = await establishHistoryBaseline(accessToken);
    await companyEmailAccountsRepo.updateSyncState(account.id, baseline);
    return;
  }

  const history = await googleProvider.listHistory(accessToken, account.historyId);

  if (history.expired) {
    // startHistoryId is outside Gmail's retention window — whatever
    // happened in that gap is permanently unrecoverable through this API.
    // The only correct move is to re-baseline, not retry with an older id
    // that will just 404 again. Same "new messages from here on" guarantee
    // as the null-historyId branch above — the gap itself is never backfilled.
    console.warn(`[gmail sync] history expired for account ${account.id} — re-baselining (messages in the gap will be missed).`);
    const baseline = await establishHistoryBaseline(accessToken);
    await companyEmailAccountsRepo.updateSyncState(account.id, baseline);
    return;
  }

  for (const messageId of history.messageIds) {
    await processOneMessage(account, accessToken, messageId);
  }

  await companyEmailAccountsRepo.updateSyncState(account.id, { historyId: history.newHistoryId });
}

/** Establishes a fresh "only new from here on" cursor. Tries watchMailbox
 * first — the production path, which both registers Pub/Sub push AND
 * returns a historyId in one call — and falls back to the push-independent
 * users.getProfile when Pub/Sub isn't configured (ProviderNotConfiguredError
 * — see integrations/google.ts's isGoogleOAuthConfigured-style config
 * check), which is exactly the local dev case: no GOOGLE_PUBSUB_TOPIC, so
 * push notifications are never registered, but polling (this same
 * processHistoryForAccount, called on an interval instead of by a webhook)
 * still works correctly against the baseline this returns. Any OTHER error
 * (a real Google API failure) propagates — this never silently swallows a
 * genuine problem. */
export async function establishHistoryBaseline(accessToken: string): Promise<{ historyId: string; watchExpiration?: Date }> {
  try {
    const watch = await googleProvider.watchMailbox(accessToken);
    return { historyId: watch.historyId, watchExpiration: watch.expiration };
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) {
      const profile = await googleProvider.getProfile(accessToken);
      return { historyId: profile.historyId };
    }
    throw e;
  }
}

/** Gmail watches expire after at most ~7 days (Google's own hard cap).
 * Renewing a full day ahead of that, on a cron that itself runs every ~15
 * minutes (see syncAllActiveAccounts), leaves enormous margin — this is
 * deliberately generous, not tuned close to the deadline, since the cost of
 * renewing a few days early is one extra Gmail API call and the cost of
 * missing the deadline is silently losing all inbound push notifications
 * for that mailbox. A null watchExpiration (never registered, or a prior
 * registerWatch attempt failed — see emailOnboarding.ts's registerWatch)
 * also counts as due, so this is also what recovers a mailbox connected
 * before Pub/Sub was configured. */
const WATCH_RENEWAL_MARGIN_MS = 24 * 60 * 60 * 1000;

export function shouldRenewWatch(account: Pick<CompanyEmailAccount, "watchExpiration">, now: Date = new Date()): boolean {
  if (!account.watchExpiration) return true;
  return account.watchExpiration.getTime() - now.getTime() < WATCH_RENEWAL_MARGIN_MS;
}

async function renewWatchIfNeeded(account: CompanyEmailAccount): Promise<void> {
  // Nothing to renew locally — without GOOGLE_PUBSUB_TOPIC there was never
  // a real watch to begin with (see establishHistoryBaseline's getProfile
  // fallback), so attempting this would just fail the same way on every
  // single cron tick. Not an error, just a no-op.
  if (!googleProvider.isGmailPubSubConfigured()) return;
  if (!shouldRenewWatch(account)) return;
  try {
    const accessToken = await getValidAccessToken(account);
    const watch = await googleProvider.watchMailbox(accessToken);
    await companyEmailAccountsRepo.updateSyncState(account.id, { historyId: account.historyId ?? watch.historyId, watchExpiration: watch.expiration });
  } catch (e) {
    console.error(`[gmail sync] failed to renew watch for account ${account.id}:`, e instanceof Error ? e.message : e);
  }
}

export type SyncSweepResult = { accountsChecked: number; accountsFailed: number; skippedConcurrent?: true };

/** Arbitrary, fixed key identifying "a Gmail sync sweep is in progress" —
 * scoped to this one purpose only (Postgres advisory locks share a single
 * global keyspace per database, so this must never collide with a lock key
 * used elsewhere; grepped the codebase, nothing else takes an advisory
 * lock today). Picked once and must never change — a different value on a
 * future deploy wouldn't leave anything "stuck" either way (transaction-
 * scoped locks always release themselves, see below), it would just stop
 * recognizing an in-flight sweep taken under the old key for the duration
 * of that one deploy. */
const GMAIL_SYNC_ADVISORY_LOCK_KEY = 847234651;

/** Per-account rate-limit backoff — exists specifically for a tight poll
 * interval (see instrumentation.ts, 3 seconds in production): without
 * this, an account Google has just rate-limited (HTTP 429, or 403 with a
 * rate-limit reason) would otherwise be retried on literally the next
 * tick, fighting the backoff a 429 response is asking for. In-memory and
 * per-account only — one rate-limited mailbox never affects any other
 * account's polling, and a process restart clears it (a fresh process
 * should optimistically retry rather than remember a cooldown from a
 * previous run). Gmail's real quota (250 units/user/second; a no-new-mail
 * tick costs ~2 units) makes this extremely unlikely to ever trigger in
 * practice — this is defense-in-depth, not a response to an observed
 * problem. */
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const rateLimitedUntil = new Map<string, number>();

export function isRateLimitError(e: unknown): boolean {
  return e instanceof GoogleApiError && (e.status === 429 || e.status === 403);
}

/** The cron entrypoint (api/cron/gmail-sync/route.ts) — for every currently
 * ACTIVE mailbox, proactively syncs history (the safety net for a Pub/Sub
 * notification that was silently dropped — see this module's doc comment)
 * and renews its watch if due. One account's failure (e.g. NEEDS_REAUTH
 * revoked mid-tick, a transient Google API error) is caught and counted,
 * never allowed to abort the sweep for every other company's mailbox.
 *
 * Wrapped in a Postgres TRANSACTION-scoped advisory lock
 * (pg_try_advisory_xact_lock, never blocking — a failed acquire just skips
 * this tick rather than queuing behind a slow run) so two overlapping
 * invocations can never process the same account concurrently. This is the
 * actual guarantee behind "no duplicate email records / no overlapping
 * sync jobs": without it, two concurrent callers could both read the same
 * stale historyId, both see the same new messages, and both pass the
 * per-conversation dedup check (which only looks at messages already
 * COMMITTED, not ones a concurrent call is mid-way through inserting)
 * before either one's insert lands — a narrow but real race the lock
 * closes entirely.
 *
 * Deliberately transaction-scoped rather than a plain session-scoped
 * pg_try_advisory_lock + manual pg_advisory_unlock: postgres.js pools
 * connections, so a lock acquired on one pooled connection and "unlocked"
 * via a separate call has no guarantee of landing on that same connection
 * — the unlock could silently no-op, leaking the lock until that other
 * connection happens to close. Wrapping the acquire itself in
 * `$client.begin()` guarantees it runs in one real transaction on one
 * fixed connection, and the lock is released automatically — no manual
 * unlock, nothing that can leak. The actual sync work below intentionally
 * runs OUTSIDE this transaction (via the normal pooled `getDb()` each repo
 * call already uses) so a long sweep across many accounts never holds one
 * database transaction open for its entire duration — only the lock
 * acquisition itself needs the fixed connection — see below: the
 * transaction is kept open for the ENTIRE sweep (the async callback simply
 * doesn't resolve until every account is processed), not just the acquire
 * check, since the lock only protects what happens while its owning
 * transaction is still open. */
export async function syncAllActiveAccounts(): Promise<SyncSweepResult> {
  const db = getDb();

  return db.$client.begin(async (tx) => {
    const rows = await tx`SELECT pg_try_advisory_xact_lock(${GMAIL_SYNC_ADVISORY_LOCK_KEY}) AS locked`;
    if (!rows[0].locked) {
      console.warn("[gmail sync] a sync sweep is already in progress — skipping this tick.");
      return { accountsChecked: 0, accountsFailed: 0, skippedConcurrent: true as const };
    }

    const accounts = await companyEmailAccountsRepo.findAllActive();
    let accountsFailed = 0;

    for (const account of accounts) {
      const cooldownUntil = rateLimitedUntil.get(account.id);
      if (cooldownUntil && Date.now() < cooldownUntil) continue; // still backing off — no API call made this tick

      try {
        await processHistoryForAccount(account);
        await renewWatchIfNeeded(account);
        rateLimitedUntil.delete(account.id); // clear any stale cooldown once a call succeeds again
      } catch (e) {
        accountsFailed++;
        if (isRateLimitError(e)) {
          rateLimitedUntil.set(account.id, Date.now() + RATE_LIMIT_COOLDOWN_MS);
          console.warn(`[gmail sync] account ${account.id} rate-limited — backing off ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
        } else {
          console.error(`[gmail sync] sweep failed for account ${account.id}:`, e instanceof Error ? e.message : e);
        }
      }
    }

    return { accountsChecked: accounts.length, accountsFailed };
  });
}

/** Constant-time comparison for the Pub/Sub push webhook's shared-secret
 * query param — see api/webhooks/gmail/route.ts's module doc comment.
 * Returns false (never throws) on any length mismatch so a missing/
 * malformed token is just "not authentic," not a crash, same convention as
 * whatsapp.ts's verifyWebhookSecret. */
export function verifyWebhookSecret(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let cachedGoogleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Lazily created and reused across requests — createRemoteJWKSet itself
 * caches the fetched key set and re-fetches only on a signature/kid miss
 * (jose's own built-in behavior), so this just avoids creating a brand-new
 * cache (and losing that benefit) on every single webhook call. */
function getGoogleJwks() {
  if (!cachedGoogleJwks) cachedGoogleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return cachedGoogleJwks;
}

export type PubSubOidcConfig = { audience: string; serviceAccountEmail: string };

/** Verifies Google Cloud Pub/Sub's authenticated push OIDC token — the
 * primary auth for api/webhooks/gmail/route.ts (the `?token=` shared
 * secret checked alongside this is defense-in-depth, not a substitute).
 * Validates every layer Pub/Sub's own docs call out as necessary: the
 * signature (against Google's own published JWKS — so the token could only
 * have been minted by Google itself), issuer, audience (so a token Google
 * issued for some OTHER service/subscription can't be replayed here), the
 * specific service account identity (so a differently-scoped-but-otherwise-
 * valid Google-signed token can't be replayed either), and expiration
 * (jwtVerify's own built-in check — a token is useless once it's expired
 * regardless of whose it was). `verifyKey` is injectable so tests can
 * verify against a local keypair instead of a real network fetch to
 * Google — see google.test.ts-style mocked-fetch regression tests. */
export async function verifyPubSubOidcToken(
  authorizationHeader: string | null,
  config: PubSubOidcConfig,
  verifyKey: Parameters<typeof jwtVerify>[1] = getGoogleJwks()
): Promise<boolean> {
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, verifyKey, {
      issuer: "https://accounts.google.com",
      audience: config.audience,
    });
    return payload.email === config.serviceAccountEmail && payload.email_verified === true;
  } catch {
    return false;
  }
}

function resolveSenderLabel(from: { name: string | null; email: string | null }): string | null {
  return from.name ?? from.email;
}

/** Which real-world participant this message should be matched against to
 * find a CRM contact: for an INBOUND message, the sender (From); for an
 * OUTBOUND one (sent directly from Gmail's own UI/app, not through
 * sendFromAccount — that path already knows its own contactId and never
 * reaches this function), the recipient (To) — the mailbox's own address
 * is never useful to match against itself. */
function resolveCounterpartEmail(direction: "INBOUND" | "OUTBOUND", message: googleProvider.GmailMessage): string | null {
  return direction === "INBOUND" ? message.from.email : message.to.email;
}

/** Resolves (or creates) the conversation a message belongs to.
 *
 * When the counterpart email matches an existing CRM contact: reuses the
 * SAME single-conversation-per-(contactId, EMAIL channel) model
 * services/email.ts's sendEmailToContact already uses for outbound sends
 * (via findByContactIdAndChannel) — never a new row keyed by Gmail's
 * threadId. This is deliberate, not a simplification: it's what makes a
 * contact's entire email history (across however many real Gmail threads)
 * roll up into the one conversation Correo's UI already knows how to show,
 * with zero changes to getConversationForContact. A new row here would be
 * invisible in the existing UI (see the architecture audit this fixes).
 *
 * When no contact matches: falls back to Gmail's own threadId as the
 * resolution key (same pattern as WhatsApp's processOneEvent) — these are
 * the Unassigned Email Inbox rows (contactId null), reviewed and manually
 * linked via services/email.ts's linkConversationToContact /
 * createContactAndLinkConversation. Deliberately never auto-creates a CRM
 * contact or lead — see this feature's approved design. */
async function resolveConversation(
  account: CompanyEmailAccount,
  message: googleProvider.GmailMessage,
  counterpartEmail: string | null
): Promise<{ conversationId: string; contactId: string | null }> {
  if (counterpartEmail) {
    const contact = await contactsRepo.findByEmail(account.companyId, counterpartEmail);
    if (contact) {
      const existing = await conversationsRepo.findByContactIdAndChannel(contact.id, CHANNEL);
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
  }

  const existingUnassigned = await conversationsRepo.findByExternalThreadId(account.companyId, CHANNEL, message.threadId);
  if (existingUnassigned) return { conversationId: existingUnassigned.id, contactId: existingUnassigned.contactId };
  const created = await conversationsRepo.create({
    companyId: account.companyId,
    channel: CHANNEL,
    externalThreadId: message.threadId,
    subject: message.subject,
    companyEmailAccountId: account.id,
  });
  return { conversationId: created.id, contactId: null };
}

async function processOneMessage(account: CompanyEmailAccount, accessToken: string, messageId: string): Promise<void> {
  let message: googleProvider.GmailMessage;
  try {
    message = await googleProvider.getMessage(accessToken, messageId);
  } catch (e) {
    console.error(`[gmail sync] failed to fetch message ${messageId} for account ${account.id}:`, e instanceof Error ? e.message : e);
    return;
  }

  if (message.labelIds.includes("DRAFT")) return;
  // Both directions are recorded: a message with the SENT label was sent
  // from this mailbox (whether through this CRM or directly from Gmail's
  // own UI/app), everything else is inbound — this gives a complete
  // bidirectional thread, not just "catch replies."
  const direction = message.labelIds.includes("SENT") ? "OUTBOUND" : "INBOUND";
  const counterpartEmail = resolveCounterpartEmail(direction, message);

  const { conversationId } = await resolveConversation(account, message, counterpartEmail);

  const existing = await messagesRepo.findByConversationId(conversationId);
  const alreadyStored = existing.some((m) => (m.metadata as { externalId?: string } | null)?.externalId === message.id);
  if (alreadyStored) return; // e.g. the echo of a message this CRM already sent via sendFromAccount

  await messagesRepo.create({
    conversationId,
    direction,
    senderLabel: resolveSenderLabel(message.from),
    body: message.body,
    // senderEmail is kept even when a contact was already matched (cheap,
    // and harmless) — it's what lets createContactAndLinkConversation
    // (services/email.ts) prefill a new contact's email address when an
    // Unassigned conversation is later linked by creating a brand-new
    // contact rather than picking an existing one.
    metadata: direction === "INBOUND" ? { externalId: message.id, senderEmail: message.from.email } : { externalId: message.id },
    sentAt: message.internalDate,
  });
  await conversationsRepo.updateLastMessageAt(conversationId, message.internalDate);
  // Realtime push is the existing, channel-agnostic Postgres trigger
  // (0009_notify_new_message.sql fires on every messages insert) — nothing
  // new is needed here for the WebSocket side.
}

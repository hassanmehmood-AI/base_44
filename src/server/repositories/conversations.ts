import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, contacts, companies, companySocialAccounts, pipelineStages } from "@/db/schema";

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
/** Only meaningful for channel === "SOCIAL" rows (the Social Media page) —
 * derived from the linked company_social_accounts row's platform
 * (META_PAGE/METRICOOL_FACEBOOK -> FACEBOOK, META_INSTAGRAM/METRICOOL_INSTAGRAM
 * -> INSTAGRAM; see db/schema.ts's companySocialAccounts comment for the full
 * platform list). Defaults to FACEBOOK for EMAIL/WHATSAPP rows and for
 * legacy SOCIAL rows with no companySocialAccountId — every webhook-created
 * SOCIAL conversation prior to this field existing came from the direct Meta
 * (Facebook) integration only (see api/webhooks/meta/route.ts, which only
 * ever ingests platform: "META_PAGE" today). */
export type ConversationWithJoins = Conversation & {
  contactName: string | null;
  companyName: string;
  platform: "FACEBOOK" | "INSTAGRAM";
  /** The linked contact's current CRM pipeline stage key (e.g. "NUEVO_LEAD")
   * — null when the conversation has no linked contactId yet (common for a
   * fresh inbound WhatsApp message before an agent links it, see
   * linkConversationToContact) or the linked contact's stage row is
   * inactive/missing. Only meaningful for channel === "WHATSAPP" today (the
   * WhatsApp page's Pipeline View groups by this); irrelevant/ignored by the
   * SOCIAL and EMAIL pages. */
  contactStageKey: string | null;
};

const INSTAGRAM_PLATFORMS = new Set(["META_INSTAGRAM", "METRICOOL_INSTAGRAM"]);

function normalizeSocialPlatform(raw: string | null): "FACEBOOK" | "INSTAGRAM" {
  return raw && INSTAGRAM_PLATFORMS.has(raw) ? "INSTAGRAM" : "FACEBOOK";
}

const baseSelect = {
  conversation: conversations,
  contactName: contacts.name,
  companyName: companies.name,
  socialPlatform: companySocialAccounts.platform,
  contactStageKey: pipelineStages.key,
};

function toJoined(row: {
  conversation: Conversation;
  contactName: string | null;
  companyName: string;
  socialPlatform: string | null;
  contactStageKey: string | null;
}): ConversationWithJoins {
  return {
    ...row.conversation,
    contactName: row.contactName,
    companyName: row.companyName,
    platform: normalizeSocialPlatform(row.socialPlatform),
    contactStageKey: row.contactStageKey,
  };
}

function baseQuery() {
  return getDb()
    .select(baseSelect)
    .from(conversations)
    .innerJoin(companies, eq(conversations.companyId, companies.id))
    .leftJoin(contacts, eq(conversations.contactId, contacts.id))
    .leftJoin(companySocialAccounts, eq(conversations.companySocialAccountId, companySocialAccounts.id))
    .leftJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id));
}

export async function findManyByCompanyIdsAndChannel(companyIds: string[], channel: string): Promise<ConversationWithJoins[]> {
  if (companyIds.length === 0) return [];
  const rows = await baseQuery()
    .where(and(inArray(conversations.companyId, companyIds), eq(conversations.channel, channel)))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt));
  return rows.map(toJoined);
}

export async function findById(id: string): Promise<ConversationWithJoins | undefined> {
  const [row] = await baseQuery().where(eq(conversations.id, id)).limit(1);
  return row ? toJoined(row) : undefined;
}

export async function findByContactIdAndChannel(contactId: string, channel: string): Promise<Conversation | undefined> {
  const [row] = await getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.contactId, contactId), eq(conversations.channel, channel)))
    .limit(1);
  return row;
}

/** Used by the inbound webhook to find the existing thread for a given
 * external sender/thread id (e.g. a Meta PSID) before creating a new one. */
export async function findByExternalThreadId(companyId: string, channel: string, externalThreadId: string): Promise<Conversation | undefined> {
  const [row] = await getDb()
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.companyId, companyId),
        eq(conversations.channel, channel),
        eq(conversations.externalThreadId, externalThreadId)
      )
    )
    .limit(1);
  return row;
}

export async function updateContactId(id: string, contactId: string): Promise<Conversation> {
  const [row] = await getDb().update(conversations).set({ contactId }).where(eq(conversations.id, id)).returning();
  return row;
}

export async function updateAssignee(id: string, assignedUserId: string | null): Promise<Conversation> {
  const [row] = await getDb().update(conversations).set({ assignedUserId }).where(eq(conversations.id, id)).returning();
  return row;
}

export async function findCompanyIdById(id: string): Promise<string | undefined> {
  const [row] = await getDb().select({ companyId: conversations.companyId }).from(conversations).where(eq(conversations.id, id)).limit(1);
  return row?.companyId;
}

export async function create(data: NewConversation): Promise<Conversation> {
  const [row] = await getDb().insert(conversations).values(data).returning();
  return row;
}

export async function updateLastMessageAt(id: string, date: Date): Promise<void> {
  await getDb().update(conversations).set({ lastMessageAt: date }).where(eq(conversations.id, id));
}

/** Reconciliation for syncMetricoolConversations: refreshes subject/avatar on
 * a conversation that already exists (never called for a brand-new row,
 * which sets both at create time instead) — used to correct conversations
 * synced before the remote.self participant fix existed. Callers only pass
 * values they've already confirmed are non-empty and different from what's
 * stored, so this never blanks out a previously-good value. */
export async function updateIdentity(
  id: string,
  data: { subject: string | null; customerAvatarUrl: string | null }
): Promise<Conversation> {
  const [row] = await getDb().update(conversations).set(data).where(eq(conversations.id, id)).returning();
  return row;
}

/** Queues a freshly-seen avatar URL for a background download attempt (see
 * services/avatarCapture.ts) — called synchronously from the sync path, but
 * is itself just a cheap single-row write, not the download. Only ever
 * called when customerAvatarKey is still null (checked by the caller), so
 * this can never overwrite an already-successfully-captured avatar. */
export async function markAvatarPending(id: string, url: string): Promise<void> {
  await getDb()
    .update(conversations)
    .set({ customerAvatarPendingUrl: url, customerAvatarCaptureAttempts: 0, customerAvatarCaptureFirstSeenAt: new Date() })
    .where(eq(conversations.id, id));
}

/** Finds conversations with a pending avatar capture still awaiting an
 * attempt — the durable queue that survives a process restart between
 * cron ticks (see avatarCapture.processPendingAvatarCaptures). */
export async function findPendingAvatarCaptures(limit: number): Promise<Conversation[]> {
  return getDb()
    .select()
    .from(conversations)
    .where(and(isNotNull(conversations.customerAvatarPendingUrl), isNull(conversations.customerAvatarKey)))
    .limit(limit);
}

export async function markAvatarCaptured(id: string, key: string): Promise<void> {
  await getDb()
    .update(conversations)
    .set({ customerAvatarKey: key, customerAvatarPendingUrl: null, customerAvatarCaptureAttempts: 0, customerAvatarCaptureFirstSeenAt: null })
    .where(eq(conversations.id, id));
}

/** Atomically claims one pending capture before attempting its download —
 * the race this closes: processPendingAvatarCaptures runs outside the
 * Metricool advisory lock (on purpose, so a slow/stuck capture can never
 * block a sync tick), so two overlapping cron ticks' after() calls could
 * otherwise both select and attempt the SAME pending row. A plain UPDATE's
 * WHERE clause is re-checked under Postgres's own row lock, so a second
 * concurrent caller's claim on an already-claimed-and-resolved row returns
 * no row (customerAvatarKey or customerAvatarPendingUrl already changed by
 * the first caller) instead of racing it — no transaction/advisory lock of
 * our own needed. Bumps the attempt count as part of the same statement, so
 * callers use the returned row's count directly rather than claiming once
 * and incrementing again separately. */
export async function claimPendingAvatarCapture(id: string): Promise<Conversation | undefined> {
  const [row] = await getDb()
    .update(conversations)
    .set({ customerAvatarCaptureAttempts: sql`${conversations.customerAvatarCaptureAttempts} + 1` })
    .where(and(eq(conversations.id, id), isNotNull(conversations.customerAvatarPendingUrl), isNull(conversations.customerAvatarKey)))
    .returning();
  return row;
}

/** Gives up on this capture — clears the pending url so it's never retried
 * again (the URL is past its proven-dead window either way; see
 * shouldAbandonPendingCapture). customerAvatarUrl/customerAvatarKey are
 * untouched: this never blanks out the existing fallback chain. */
export async function abandonPendingAvatar(id: string): Promise<void> {
  await getDb()
    .update(conversations)
    .set({ customerAvatarPendingUrl: null })
    .where(eq(conversations.id, id));
}

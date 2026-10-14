import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, contacts, companies, companySocialAccounts } from "@/db/schema";

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
export type ConversationWithJoins = Conversation & { contactName: string | null; companyName: string; platform: "FACEBOOK" | "INSTAGRAM" };

const INSTAGRAM_PLATFORMS = new Set(["META_INSTAGRAM", "METRICOOL_INSTAGRAM"]);

function normalizeSocialPlatform(raw: string | null): "FACEBOOK" | "INSTAGRAM" {
  return raw && INSTAGRAM_PLATFORMS.has(raw) ? "INSTAGRAM" : "FACEBOOK";
}

const baseSelect = {
  conversation: conversations,
  contactName: contacts.name,
  companyName: companies.name,
  socialPlatform: companySocialAccounts.platform,
};

function toJoined(row: {
  conversation: Conversation;
  contactName: string | null;
  companyName: string;
  socialPlatform: string | null;
}): ConversationWithJoins {
  return {
    ...row.conversation,
    contactName: row.contactName,
    companyName: row.companyName,
    platform: normalizeSocialPlatform(row.socialPlatform),
  };
}

function baseQuery() {
  return getDb()
    .select(baseSelect)
    .from(conversations)
    .innerJoin(companies, eq(conversations.companyId, companies.id))
    .leftJoin(contacts, eq(conversations.contactId, contacts.id))
    .leftJoin(companySocialAccounts, eq(conversations.companySocialAccountId, companySocialAccounts.id));
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

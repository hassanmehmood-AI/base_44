import { and, desc, eq, inArray, notExists } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, companies, pipelineStages, users, campaignContacts } from "@/db/schema";

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type ContactUpdate = Partial<Omit<NewContact, "id" | "companyId" | "createdAt">>;

export type ContactWithJoins = Contact & {
  companyName: string;
  stageKey: string;
  assignedUserName: string | null;
};

const baseSelect = {
  contact: contacts,
  companyName: companies.name,
  stageKey: pipelineStages.key,
  assignedUserName: users.fullName,
};

function toJoined(row: { contact: Contact; companyName: string; stageKey: string; assignedUserName: string | null }): ContactWithJoins {
  return { ...row.contact, companyName: row.companyName, stageKey: row.stageKey, assignedUserName: row.assignedUserName };
}

export async function findManyByCompanyIds(companyIds: string[]): Promise<ContactWithJoins[]> {
  if (companyIds.length === 0) return [];
  const rows = await getDb()
    .select(baseSelect)
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .innerJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(contacts.assignedUserId, users.id))
    .where(inArray(contacts.companyId, companyIds))
    .orderBy(desc(contacts.createdAt));
  return rows.map(toJoined);
}

/** Contacts linked to a given campaign via campaign_contacts — the CRM page's
 * "Campaign" filter. Caller must authorize the campaign's companyId first. */
export async function findManyByCampaignId(campaignId: string): Promise<ContactWithJoins[]> {
  const rows = await getDb()
    .select(baseSelect)
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .innerJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(contacts.assignedUserId, users.id))
    .innerJoin(campaignContacts, eq(campaignContacts.contactId, contacts.id))
    .where(eq(campaignContacts.campaignId, campaignId))
    .orderBy(desc(contacts.createdAt));
  return rows.map(toJoined);
}

/** Contacts with no campaign_contacts row at all — the CRM page's "Manual
 * Leads" filter. Reliable because campaign linkage is a hard relational
 * fact (set only by campaign CSV import), not inferred from free-text
 * leadSource. Scoped to the caller's already-authorized company ids. */
export async function findManualByCompanyIds(companyIds: string[]): Promise<ContactWithJoins[]> {
  if (companyIds.length === 0) return [];
  const rows = await getDb()
    .select(baseSelect)
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .innerJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(contacts.assignedUserId, users.id))
    .where(
      and(
        inArray(contacts.companyId, companyIds),
        notExists(getDb().select().from(campaignContacts).where(eq(campaignContacts.contactId, contacts.id)))
      )
    )
    .orderBy(desc(contacts.createdAt));
  return rows.map(toJoined);
}

export async function findById(id: string): Promise<ContactWithJoins | undefined> {
  const [row] = await getDb()
    .select(baseSelect)
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .innerJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(contacts.assignedUserId, users.id))
    .where(eq(contacts.id, id))
    .limit(1);
  return row ? toJoined(row) : undefined;
}

/** Plain (unjoined) row — used internally to check a contact's companyId
 * before authorizing a write, without paying for the full join. */
export async function findCompanyIdById(id: string): Promise<string | undefined> {
  const [row] = await getDb().select({ companyId: contacts.companyId }).from(contacts).where(eq(contacts.id, id)).limit(1);
  return row?.companyId;
}

export async function create(data: NewContact, db: ReturnType<typeof getDb> = getDb()): Promise<Contact> {
  const [row] = await db.insert(contacts).values(data).returning();
  return row;
}

export async function createMany(rows: NewContact[], db: ReturnType<typeof getDb> = getDb()): Promise<Contact[]> {
  if (rows.length === 0) return [];
  return db.insert(contacts).values(rows).returning();
}

export async function update(id: string, data: ContactUpdate): Promise<Contact> {
  const [row] = await getDb()
    .update(contacts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(contacts.id, id))
    .returning();
  return row;
}

/** Runs `fn` with a transactional db handle — used by classifyContact() to
 * update the contact and append its Activity atomically. */
export async function withTransaction<T>(fn: (tx: ReturnType<typeof getDb>) => Promise<T>): Promise<T> {
  return getDb().transaction((tx) => fn(tx as unknown as ReturnType<typeof getDb>));
}

export async function updateInTx(
  db: ReturnType<typeof getDb>,
  id: string,
  data: ContactUpdate & { lastContactAt?: Date }
): Promise<Contact> {
  const [row] = await db
    .update(contacts)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(contacts.id, id)))
    .returning();
  return row;
}

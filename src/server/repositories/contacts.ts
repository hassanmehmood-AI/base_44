import { and, desc, eq, inArray, notExists, exists, or } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, companies, pipelineStages, users, campaignContacts, campaigns, managerAgentAssignments } from "@/db/schema";

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

/** Call Center Agent's CRM "All Contacts" view (hierarchy redesign phase 4):
 * only contacts assigned to them, scoped to their allowed companies. */
export async function findManyByAssignedUserId(companyIds: string[], assignedUserId: string): Promise<ContactWithJoins[]> {
  if (companyIds.length === 0) return [];
  const rows = await getDb()
    .select(baseSelect)
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .innerJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(contacts.assignedUserId, users.id))
    .where(and(inArray(contacts.companyId, companyIds), eq(contacts.assignedUserId, assignedUserId)))
    .orderBy(desc(contacts.createdAt));
  return rows.map(toJoined);
}

/** Call Center Manager's CRM "All Contacts" view (hierarchy redesign phase
 * 4): contacts linked (via campaign_contacts) to a campaign this manager
 * owns, OR contacts currently assigned to one of this manager's own agents
 * (manager_agent_assignments) — the latter keeps a manager's view of their
 * team's work intact even for leads assigned before a campaign link existed
 * or for manually-created leads outside any campaign. Scoped to their
 * allowed companies. */
export async function findManyByManagerScope(companyIds: string[], managerUserId: string): Promise<ContactWithJoins[]> {
  if (companyIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select(baseSelect)
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .innerJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(contacts.assignedUserId, users.id))
    .where(
      and(
        inArray(contacts.companyId, companyIds),
        or(
          exists(
            db
              .select()
              .from(campaignContacts)
              .innerJoin(campaigns, eq(campaigns.id, campaignContacts.campaignId))
              .where(and(eq(campaignContacts.contactId, contacts.id), eq(campaigns.ownerId, managerUserId)))
          ),
          exists(
            db
              .select()
              .from(managerAgentAssignments)
              .where(
                and(
                  eq(managerAgentAssignments.agentUserId, contacts.assignedUserId),
                  eq(managerAgentAssignments.managerUserId, managerUserId)
                )
              )
          )
        )
      )
    )
    .orderBy(desc(contacts.createdAt));
  return rows.map(toJoined);
}

/** Agent-scoped "Manual Leads" filter — same role-scoping as
 * findManyByAssignedUserId, additionally excluding any contact linked to a
 * campaign (matches findManualByCompanyIds' definition of "manual"). */
export async function findManualByAssignedUserId(companyIds: string[], assignedUserId: string): Promise<ContactWithJoins[]> {
  if (companyIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select(baseSelect)
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .innerJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(contacts.assignedUserId, users.id))
    .where(
      and(
        inArray(contacts.companyId, companyIds),
        eq(contacts.assignedUserId, assignedUserId),
        notExists(db.select().from(campaignContacts).where(eq(campaignContacts.contactId, contacts.id)))
      )
    )
    .orderBy(desc(contacts.createdAt));
  return rows.map(toJoined);
}

/** Manager-scoped "Manual Leads" filter: campaign-less contacts assigned to
 * one of this manager's own agents (the campaign-ownership half of
 * findManyByManagerScope doesn't apply here by definition — these have no
 * campaign link). */
export async function findManualByManagerScope(companyIds: string[], managerUserId: string): Promise<ContactWithJoins[]> {
  if (companyIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select(baseSelect)
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .innerJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(contacts.assignedUserId, users.id))
    .where(
      and(
        inArray(contacts.companyId, companyIds),
        notExists(db.select().from(campaignContacts).where(eq(campaignContacts.contactId, contacts.id))),
        exists(
          db
            .select()
            .from(managerAgentAssignments)
            .where(
              and(
                eq(managerAgentAssignments.agentUserId, contacts.assignedUserId),
                eq(managerAgentAssignments.managerUserId, managerUserId)
              )
            )
        )
      )
    )
    .orderBy(desc(contacts.createdAt));
  return rows.map(toJoined);
}

/** CRM's "Campaign" filter, scoped to a Call Center Agent: only the
 * campaign's contacts that are also assigned to them. */
export async function findManyByCampaignIdAndAssignedUser(campaignId: string, assignedUserId: string): Promise<ContactWithJoins[]> {
  const rows = await getDb()
    .select(baseSelect)
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .innerJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(contacts.assignedUserId, users.id))
    .innerJoin(campaignContacts, eq(campaignContacts.contactId, contacts.id))
    .where(and(eq(campaignContacts.campaignId, campaignId), eq(contacts.assignedUserId, assignedUserId)))
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

/** Just the two identifier columns, scoped to one company — used by the
 * import's duplicate check. Deliberately not an `inArray(email, [...])`
 * lookup: email/phone aren't stored normalized, so the caller normalizes
 * (case, formatting) and compares in JS against this full set rather than
 * risking an exact-match query silently missing equivalent values. */
export async function findEmailsAndPhonesByCompanyId(
  companyId: string
): Promise<{ email: string | null; phone: string | null }[]> {
  return getDb().select({ email: contacts.email, phone: contacts.phone }).from(contacts).where(eq(contacts.companyId, companyId));
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

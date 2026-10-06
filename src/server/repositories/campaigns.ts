import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { campaigns, companies, users } from "@/db/schema";

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type CampaignWithJoins = Campaign & { companyName: string; ownerName: string | null };

const baseSelect = {
  campaign: campaigns,
  companyName: companies.name,
  ownerName: users.fullName,
};

function toJoined(row: { campaign: Campaign; companyName: string; ownerName: string | null }): CampaignWithJoins {
  return { ...row.campaign, companyName: row.companyName, ownerName: row.ownerName };
}

export async function findManyByCompanyIds(companyIds: string[]): Promise<CampaignWithJoins[]> {
  if (companyIds.length === 0) return [];
  const rows = await getDb()
    .select(baseSelect)
    .from(campaigns)
    .innerJoin(companies, eq(campaigns.companyId, companies.id))
    .leftJoin(users, eq(campaigns.ownerId, users.id))
    .where(inArray(campaigns.companyId, companyIds))
    .orderBy(desc(campaigns.createdAt));
  return rows.map(toJoined);
}

/** Campaign list scoped to a Call Center Manager: only campaigns they're
 * assigned to (ownerId = them), within their allowed companies — the
 * Manager-level equivalent of findManyByCompanyIds(). */
export async function findManyByCompanyIdsAndOwner(companyIds: string[], ownerId: string): Promise<CampaignWithJoins[]> {
  if (companyIds.length === 0) return [];
  const rows = await getDb()
    .select(baseSelect)
    .from(campaigns)
    .innerJoin(companies, eq(campaigns.companyId, companies.id))
    .leftJoin(users, eq(campaigns.ownerId, users.id))
    .where(and(inArray(campaigns.companyId, companyIds), eq(campaigns.ownerId, ownerId)))
    .orderBy(desc(campaigns.createdAt));
  return rows.map(toJoined);
}

export async function findCompanyIdById(id: string): Promise<string | undefined> {
  const [row] = await getDb().select({ companyId: campaigns.companyId }).from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return row?.companyId;
}

export async function create(data: NewCampaign): Promise<Campaign> {
  const [row] = await getDb().insert(campaigns).values(data).returning();
  return row;
}

export async function updateStatus(id: string, status: string): Promise<Campaign> {
  const [row] = await getDb().update(campaigns).set({ status }).where(eq(campaigns.id, id)).returning();
  return row;
}

/** Reassigns the campaign's manager (ownerId) — the only field this touches.
 * Never cascades to campaign_contacts/contacts/activities: historical lead
 * assignments stay exactly as they were, by construction (no other table is
 * written here). */
export async function updateOwner(id: string, ownerId: string | null): Promise<Campaign> {
  const [row] = await getDb().update(campaigns).set({ ownerId }).where(eq(campaigns.id, id)).returning();
  return row;
}

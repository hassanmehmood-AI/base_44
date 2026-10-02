import { desc, eq, inArray } from "drizzle-orm";
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

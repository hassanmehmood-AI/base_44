import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companySocialAccounts } from "@/db/schema";

export type CompanySocialAccount = typeof companySocialAccounts.$inferSelect;
export type NewCompanySocialAccount = typeof companySocialAccounts.$inferInsert;

export async function findCompanyIdByExternalPage(platform: string, externalPageId: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ companyId: companySocialAccounts.companyId })
    .from(companySocialAccounts)
    .where(and(eq(companySocialAccounts.platform, platform), eq(companySocialAccounts.externalPageId, externalPageId)))
    .limit(1);
  return row?.companyId;
}

export async function create(data: NewCompanySocialAccount): Promise<CompanySocialAccount> {
  const [row] = await getDb().insert(companySocialAccounts).values(data).returning();
  return row;
}

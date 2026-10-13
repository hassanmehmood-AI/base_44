import { and, eq, inArray } from "drizzle-orm";
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

export async function findById(id: string): Promise<CompanySocialAccount | undefined> {
  const [row] = await getDb().select().from(companySocialAccounts).where(eq(companySocialAccounts.id, id)).limit(1);
  return row;
}

/** One company's connected accounts — a cheap DB-only read (no Metricool
 * call), used as the "is this company provisioned at all" signal. */
export async function findByCompanyId(companyId: string): Promise<CompanySocialAccount[]> {
  return getDb().select().from(companySocialAccounts).where(eq(companySocialAccounts.companyId, companyId));
}

/** Same as findByCompanyId, batched across many companies at once (e.g. the
 * Configuración companies list) rather than N+1'ing per card. */
export async function findByCompanyIds(companyIds: string[]): Promise<CompanySocialAccount[]> {
  if (companyIds.length === 0) return [];
  return getDb().select().from(companySocialAccounts).where(inArray(companySocialAccounts.companyId, companyIds));
}

/** Every connected account for the given platform(s) — used by the
 * Metricool poll-sync job to iterate all companies' connected
 * Instagram/Facebook accounts in one pass (see services/social.ts
 * syncMetricoolConversations and the cron route that calls it per row). */
export async function listByPlatforms(platforms: string[]): Promise<CompanySocialAccount[]> {
  return getDb().select().from(companySocialAccounts).where(inArray(companySocialAccounts.platform, platforms));
}

export async function create(data: NewCompanySocialAccount): Promise<CompanySocialAccount> {
  const [row] = await getDb().insert(companySocialAccounts).values(data).returning();
  return row;
}

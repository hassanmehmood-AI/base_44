import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userCompanyAccess, userModuleAccess } from "@/db/schema";

export async function findCompanyIdsForUser(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ companyId: userCompanyAccess.companyId })
    .from(userCompanyAccess)
    .where(eq(userCompanyAccess.userId, userId));
  return rows.map((r) => r.companyId);
}

export async function findModulesForUser(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ module: userModuleAccess.module })
    .from(userModuleAccess)
    .where(eq(userModuleAccess.userId, userId));
  return rows.map((r) => r.module);
}

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

export async function grantCompanyAccess(userId: string, companyIds: string[]) {
  if (companyIds.length === 0) return;
  await getDb()
    .insert(userCompanyAccess)
    .values(companyIds.map((companyId) => ({ userId, companyId })))
    .onConflictDoNothing();
}

export async function grantModuleAccess(userId: string, modules: string[]) {
  if (modules.length === 0) return;
  await getDb()
    .insert(userModuleAccess)
    .values(modules.map((module) => ({ userId, module })))
    .onConflictDoNothing();
}

/** Replaces a user's full company-access set with exactly the given ids. */
export async function replaceCompanyAccess(userId: string, companyIds: string[]) {
  const db = getDb();
  await db.delete(userCompanyAccess).where(eq(userCompanyAccess.userId, userId));
  if (companyIds.length > 0) {
    await db.insert(userCompanyAccess).values(companyIds.map((companyId) => ({ userId, companyId })));
  }
}

/** Replaces a user's full module-access set with exactly the given modules. */
export async function replaceModuleAccess(userId: string, modules: string[]) {
  const db = getDb();
  await db.delete(userModuleAccess).where(eq(userModuleAccess.userId, userId));
  if (modules.length > 0) {
    await db.insert(userModuleAccess).values(modules.map((module) => ({ userId, module })));
  }
}

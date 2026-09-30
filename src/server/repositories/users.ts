import { eq, ne, or, exists, and } from "drizzle-orm";
import { getDb } from "@/db";
import { users, roles, userCompanyAccess } from "@/db/schema";
import type { RoleKey } from "@/server/constants";

export type User = typeof users.$inferSelect;
export type UserWithRole = User & { roleKey: RoleKey };

export async function findByEmail(email: string): Promise<UserWithRole | undefined> {
  const [row] = await getDb()
    .select({ user: users, roleKey: roles.key })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.email, email))
    .limit(1);
  return row ? { ...row.user, roleKey: row.roleKey as RoleKey } : undefined;
}

export async function findById(id: string): Promise<UserWithRole | undefined> {
  const [row] = await getDb()
    .select({ user: users, roleKey: roles.key })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1);
  return row ? { ...row.user, roleKey: row.roleKey as RoleKey } : undefined;
}

export async function existsByEmail(email: string): Promise<boolean> {
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return !!row;
}

export async function findRoleIdByKey(roleKey: RoleKey): Promise<string | undefined> {
  const [row] = await getDb().select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey)).limit(1);
  return row?.id;
}

export async function create(input: {
  fullName: string;
  email: string;
  passwordHash: string;
  roleId: string;
}): Promise<User> {
  const [row] = await getDb().insert(users).values(input).returning();
  return row;
}

/** Real, active accounts a Superuser could switch into — excludes other
 * Superusers by design (no impersonating a fellow admin) and excludes
 * inactive/deactivated accounts. */
export async function findImpersonatableUsers(): Promise<UserWithRole[]> {
  const db = getDb();
  const rows = await db
    .select({ user: users, roleKey: roles.key })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.isActive, true), ne(roles.key, "SUPERUSER")))
    .orderBy(users.fullName);
  return rows.map((r) => ({ ...r.user, roleKey: r.roleKey as RoleKey }));
}

/** Users a contact in this company could sensibly be assigned to: SUPERUSERs
 * (implicit access everywhere) plus anyone explicitly granted this company. */
export async function findAssignableForCompany(companyId: string): Promise<UserWithRole[]> {
  const db = getDb();
  const rows = await db
    .select({ user: users, roleKey: roles.key })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(
      and(
        eq(users.isActive, true),
        or(
          eq(roles.key, "SUPERUSER"),
          exists(
            db
              .select()
              .from(userCompanyAccess)
              .where(and(eq(userCompanyAccess.userId, users.id), eq(userCompanyAccess.companyId, companyId)))
          )
        )
      )
    )
    .orderBy(users.fullName);
  return rows.map((r) => ({ ...r.user, roleKey: r.roleKey as RoleKey }));
}

import { eq, or, exists, and } from "drizzle-orm";
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

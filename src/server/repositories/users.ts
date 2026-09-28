import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, roles } from "@/db/schema";
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

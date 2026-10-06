import { eq, ne, or, exists, and, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { users, roles, userCompanyAccess, managerAgentAssignments } from "@/db/schema";
import { ROUND_ROBIN_ELIGIBLE_ROLES, type RoleKey } from "@/server/constants";

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

export async function findAll(): Promise<UserWithRole[]> {
  const rows = await getDb()
    .select({ user: users, roleKey: roles.key })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .orderBy(users.fullName);
  return rows.map((r) => ({ ...r.user, roleKey: r.roleKey as RoleKey }));
}

export async function setActive(userId: string, isActive: boolean): Promise<void> {
  await getDb().update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, userId));
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

/** Candidates for automatic Round Robin assignment for this company: active,
 * explicitly granted this company (Superuser's implicit access does NOT
 * count here — Superuser is deliberately excluded from auto-assignment),
 * and holding one of ROUND_ROBIN_ELIGIBLE_ROLES. Ordered by id for a stable,
 * deterministic rotation order. Takes the db/tx handle explicitly so the
 * caller can run this inside the same transaction as the cursor lock. */
export async function findEligibleForRoundRobin(
  db: ReturnType<typeof getDb>,
  companyId: string
): Promise<{ id: string }[]> {
  return db
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .innerJoin(userCompanyAccess, eq(userCompanyAccess.userId, users.id))
    .where(
      and(
        eq(users.isActive, true),
        eq(userCompanyAccess.companyId, companyId),
        inArray(roles.key, ROUND_ROBIN_ELIGIBLE_ROLES)
      )
    )
    .orderBy(users.id);
}

/** Active users holding a specific role, explicitly granted this company —
 * used for the manager-hierarchy admin UI (e.g. "which Call Center Managers
 * exist in this company" for the manager-assignment dropdown). */
export async function findUsersByRoleForCompany(companyId: string, roleKey: RoleKey): Promise<UserWithRole[]> {
  const rows = await getDb()
    .select({ user: users, roleKey: roles.key })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .innerJoin(userCompanyAccess, eq(userCompanyAccess.userId, users.id))
    .where(and(eq(users.isActive, true), eq(userCompanyAccess.companyId, companyId), eq(roles.key, roleKey)))
    .orderBy(users.fullName);
  return rows.map((r) => ({ ...r.user, roleKey: r.roleKey as RoleKey }));
}

/** This manager's agents in this company, via manager_agent_assignments —
 * the admin UI's "Team" read-out on a Manager's row. */
export async function findTeamForManager(managerUserId: string, companyId: string): Promise<UserWithRole[]> {
  const rows = await getDb()
    .select({ user: users, roleKey: roles.key })
    .from(managerAgentAssignments)
    .innerJoin(users, eq(users.id, managerAgentAssignments.agentUserId))
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(managerAgentAssignments.managerUserId, managerUserId), eq(managerAgentAssignments.companyId, companyId)))
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

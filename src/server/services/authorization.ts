import { auth } from "@/auth";
import type { ModuleKey } from "@/server/constants";

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Session accessor every server-side data function should go through — never
 * trust a companyId/module passed from the client without checking it here. */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError("Not signed in.");
  return session;
}

function isSuperuser(roleKey: string) {
  return roleKey === "SUPERUSER";
}

/** Throws unless the current session user may access the given company.
 * SUPERUSER implicitly has access to every company (matches the role's
 * "Full access to all modules and companies" description in Configuración). */
export async function assertCompanyAccess(companyId: string) {
  const session = await requireSession();
  if (isSuperuser(session.user.roleKey)) return session;
  if (!session.user.companyIds.includes(companyId)) {
    throw new UnauthorizedError(`Not authorized for company ${companyId}.`);
  }
  return session;
}

/** Narrower than assertCompanyAccess: throws unless the caller is a
 * Superuser, or a Director with explicit access to this specific company.
 * Used by top-down manager-hierarchy actions (manager/agent assignment,
 * campaign-manager reassignment) that only Directors and Superusers should
 * perform — never the Manager/Agent/Marketing roles, even if they have
 * company access themselves. A Director granted company A cannot use this
 * for company B. */
export async function assertDirectorOrSuperuser(companyId: string) {
  const session = await requireSession();
  if (isSuperuser(session.user.roleKey)) return session;
  if (session.user.roleKey === "DIRECTOR" && session.user.companyIds.includes(companyId)) return session;
  throw new UnauthorizedError(`Only a Superuser or company ${companyId}'s Director can perform this action.`);
}

export async function assertModuleAccess(module: ModuleKey) {
  const session = await requireSession();
  if (isSuperuser(session.user.roleKey)) return session;
  if (!session.user.modules.includes(module)) {
    throw new UnauthorizedError(`Not authorized for module ${module}.`);
  }
  return session;
}

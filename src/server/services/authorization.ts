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

export async function assertModuleAccess(module: ModuleKey) {
  const session = await requireSession();
  if (isSuperuser(session.user.roleKey)) return session;
  if (!session.user.modules.includes(module)) {
    throw new UnauthorizedError(`Not authorized for module ${module}.`);
  }
  return session;
}

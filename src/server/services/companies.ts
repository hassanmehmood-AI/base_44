import * as companiesRepo from "@/server/repositories/companies";
import { requireSession } from "@/server/services/authorization";

/** Companies the signed-in user is allowed to see — SUPERUSER gets every
 * active company, everyone else gets exactly their user_company_access grants.
 * Returns plain names (not full rows): the frontend's CompanyContext and all
 * of the still-mock-data-driven pages (CRM, Soporte, Campañas, ...) filter by
 * company *name* strings, so this is the compatibility boundary between real
 * identity/access data and the not-yet-migrated CRM modules. */
export async function getAllowedCompanyNamesForCurrentUser(): Promise<string[]> {
  const session = await requireSession();

  if (session.user.roleKey === "SUPERUSER") {
    const all = await companiesRepo.findAllActive();
    return all.map((c) => c.name);
  }

  if (session.user.companyIds.length === 0) return [];
  const allowed = await companiesRepo.findByIds(session.user.companyIds);
  return allowed.filter((c) => c.isActive).map((c) => c.name);
}

/** Same authorization as above, but returning {id, name} — needed anywhere
 * that has to store a real companyId (e.g. creating a contact), not just
 * display/filter by name. */
export async function getAllowedCompaniesForCurrentUser() {
  const session = await requireSession();

  if (session.user.roleKey === "SUPERUSER") {
    const all = await companiesRepo.findAllActive();
    return all.map((c) => ({ id: c.id, name: c.name }));
  }

  if (session.user.companyIds.length === 0) return [];
  const allowed = await companiesRepo.findByIds(session.user.companyIds);
  return allowed.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }));
}

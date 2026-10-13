import * as companiesRepo from "@/server/repositories/companies";
import { requireSession, UnauthorizedError } from "@/server/services/authorization";
import { autoProvisionMetricoolBrand } from "@/server/services/metricoolOnboarding";

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Only Superusers add companies — every other role's access is scoped BY
 * company (user_company_access), so letting a non-Superuser create one would
 * have no coherent owner. */
export async function createCompany(name: string) {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") throw new UnauthorizedError("Only Superusers can add companies.");

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Company name is required.");
  const slug = slugify(trimmed);
  if (!slug) throw new Error("Company name must contain at least one letter or number.");
  if (await companiesRepo.existsByName(trimmed)) throw new Error("A company with that name already exists.");

  const company = await companiesRepo.create({ name: trimmed, slug });

  // Best-effort — autoProvisionMetricoolBrand never throws (see
  // metricoolOnboarding.ts), but a defensive catch here too means a Metricool
  // outage can never take down company creation even if that contract
  // changes later. Failure just leaves the company unprovisioned, visible
  // and retryable from the Configuración UI.
  try {
    await autoProvisionMetricoolBrand(company.id, company.name);
  } catch (e) {
    console.error(`[companies] Metricool auto-provisioning failed for company ${company.id}:`, e);
  }

  return company;
}

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

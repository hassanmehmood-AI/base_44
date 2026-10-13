import * as companiesRepo from "@/server/repositories/companies";
import * as companySocialAccountsRepo from "@/server/repositories/companySocialAccounts";
import * as metricoolProvider from "@/server/integrations/metricool";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";
import { requireSession, UnauthorizedError } from "@/server/services/authorization";

/** Company onboarding into the shared Metricool account — separate from
 * services/social.ts (which only handles conversations for already-
 * connected accounts) because this is an admin/provisioning concern, not a
 * channel/conversations one. Keeps social.ts's scope unchanged.
 *
 * All Metricool calls here are genuinely external and can fail for reasons
 * outside this CRM's control (network, brand limit, not configured yet) —
 * every exported function that's reachable from a UI action is written to
 * degrade to a clear status/error rather than throwing where throwing would
 * break an otherwise-successful operation (see autoProvisionMetricoolBrand,
 * called from companies.ts's createCompany — a Metricool outage must never
 * block creating a company). */

const METRICOOL_PLATFORMS = ["METRICOOL_INSTAGRAM", "METRICOOL_FACEBOOK"] as const;

async function assertSuperuser() {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") {
    throw new UnauthorizedError("Only Superusers can manage Metricool connections.");
  }
  return session;
}

export type ProvisionResult =
  | { ok: true; blogId: string }
  | { ok: false; reason: "not_configured" | "already_provisioned" | "possible_duplicate" | "error"; message: string; matchedBrand?: { blogId: string; label: string } };

/** Best-effort — never throws. Called right after a new company row is
 * inserted (see companies.ts createCompany); a Metricool failure here must
 * never undo or block that insert, so every failure path returns a result
 * instead of raising. */
export async function autoProvisionMetricoolBrand(companyId: string, companyName: string): Promise<ProvisionResult> {
  if (!metricoolProvider.isMetricoolConfigured()) {
    return { ok: false, reason: "not_configured", message: "Metricool is not configured yet." };
  }

  const existing = await companySocialAccountsRepo.findByCompanyId(companyId);
  if (existing.some((row) => (METRICOOL_PLATFORMS as readonly string[]).includes(row.platform))) {
    return { ok: false, reason: "already_provisioned", message: "This company already has a linked Metricool brand." };
  }

  try {
    // Duplicate prevention: if a brand with this exact name already exists
    // in the shared Metricool account, don't blindly create a second one —
    // surface it so an admin can consciously link it instead (see
    // linkExistingBrand) rather than silently guessing a name match is the
    // same company.
    const [brands, allLinkedAccounts] = await Promise.all([
      metricoolProvider.listBrands(),
      companySocialAccountsRepo.listByPlatforms([...METRICOOL_PLATFORMS]),
    ]);
    const linkedBlogIds = new Set(allLinkedAccounts.map((a) => a.externalPageId));
    const normalizedName = companyName.trim().toLowerCase();
    const possibleMatch = brands.find(
      (b) => b.label?.trim().toLowerCase() === normalizedName && !linkedBlogIds.has(String(b.id))
    );
    if (possibleMatch) {
      return {
        ok: false,
        reason: "possible_duplicate",
        message: `A Metricool brand named "${possibleMatch.label}" already exists and isn't linked to any company yet.`,
        matchedBrand: { blogId: String(possibleMatch.id), label: possibleMatch.label },
      };
    }

    const brand = await metricoolProvider.createBrand(companyName);
    const blogId = String(brand.id);
    await linkBrandRows(companyId, blogId);
    return { ok: true, blogId };
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) {
      return { ok: false, reason: "not_configured", message: e.message };
    }
    const message = e instanceof Error ? e.message : "Unknown Metricool error.";
    const friendly = message.includes("(403)")
      ? "Metricool's brand limit has been reached for this account — delete an unused brand or upgrade the plan, then retry."
      : message;
    return { ok: false, reason: "error", message: friendly };
  }
}

/** Inserts the two platform rows (Instagram + Facebook) a single Metricool
 * brand provides, both pointing at the same blogId — Metricool connects
 * both networks under one brand, unlike the direct-Meta integration where a
 * Facebook Page and an Instagram Business Account are genuinely different
 * external ids. Keeping two rows (rather than reshaping the schema) means
 * the sync/reply logic built for social.ts needs no changes. The existing
 * unique index on (platform, externalPageId) is what actually guarantees
 * company isolation here — a second company can never successfully link the
 * same blogId. */
async function linkBrandRows(companyId: string, blogId: string): Promise<void> {
  try {
    await companySocialAccountsRepo.create({ companyId, platform: "METRICOOL_INSTAGRAM", externalPageId: blogId });
    await companySocialAccountsRepo.create({ companyId, platform: "METRICOOL_FACEBOOK", externalPageId: blogId });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new Error("This Metricool brand is already linked to another company.");
    }
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}

export type CompanyProvisioningStatus = {
  companyId: string;
  blogId: string | null;
};

/** DB-only (no Metricool call) — safe to compute for every company on every
 * Configuración page load, unlike getLiveConnectionStatus below. */
export async function getProvisioningStatusForCompanies(companyIds: string[]): Promise<CompanyProvisioningStatus[]> {
  await assertSuperuser();
  const rows = await companySocialAccountsRepo.findByCompanyIds(companyIds);
  return companyIds.map((companyId) => {
    const row = rows.find((r) => r.companyId === companyId && (METRICOOL_PLATFORMS as readonly string[]).includes(r.platform));
    return { companyId, blogId: row?.externalPageId ?? null };
  });
}

export type LiveConnectionStatus =
  | { provisioned: false }
  | { provisioned: true; blogId: string; brandLabel: string; instagramConnected: boolean; facebookConnected: boolean }
  | { provisioned: true; blogId: string; error: string };

/** Live Metricool call — only invoke on-demand (a "check status" button),
 * never eagerly for a whole company list, so a slow/unreachable Metricool
 * never slows down or breaks the Configuración page itself. */
export async function getLiveConnectionStatus(companyId: string): Promise<LiveConnectionStatus> {
  await assertSuperuser();
  const rows = await companySocialAccountsRepo.findByCompanyId(companyId);
  const blogId = rows.find((r) => (METRICOOL_PLATFORMS as readonly string[]).includes(r.platform))?.externalPageId;
  if (!blogId) return { provisioned: false };

  try {
    const brand = await metricoolProvider.getBrand(blogId);
    // Exact connector string values aren't confirmed from the spec alone —
    // match case-insensitively by substring rather than an exact literal.
    const connectors = (brand.availableConnectors ?? []).map((c) => c.toLowerCase());
    return {
      provisioned: true,
      blogId,
      brandLabel: brand.label ?? brand.title ?? "",
      instagramConnected: connectors.some((c) => c.includes("instagram")),
      facebookConnected: connectors.some((c) => c.includes("facebook")),
    };
  } catch (e) {
    const message = e instanceof ProviderNotConfiguredError ? e.message : e instanceof Error ? e.message : "Unknown error.";
    return { provisioned: true, blogId, error: message };
  }
}

/** Manual retry for a company that failed auto-provisioning (Metricool was
 * down, brand limit was hit at the time, etc.) — same function, called
 * again on purpose instead of automatically, since this app has no
 * background job/retry-queue infrastructure to add one safely. */
export async function retryProvisioning(companyId: string): Promise<ProvisionResult> {
  await assertSuperuser();
  const company = await companiesRepo.findById(companyId);
  if (!company) throw new Error("Company not found.");
  return autoProvisionMetricoolBrand(companyId, company.name);
}

/** The reply/connect step itself never happens through this CRM's backend —
 * see metricool.ts's createConnectionLink doc comment for why (Meta requires
 * real user consent; Metricool's only API-level support for that is this
 * hosted-panel link). This just brokers Metricool's own link-generation
 * call for whichever company's brand is asking. */
export async function generateConnectionLink(companyId: string): Promise<metricoolProvider.MetricoolConnectionLink> {
  await assertSuperuser();
  const rows = await companySocialAccountsRepo.findByCompanyId(companyId);
  const blogId = rows.find((r) => (METRICOOL_PLATFORMS as readonly string[]).includes(r.platform))?.externalPageId;
  if (!blogId) throw new Error("Provision a Metricool brand for this company before generating a connection link.");
  return metricoolProvider.createConnectionLink(blogId);
}

export type LinkableBrand = { blogId: string; label: string; alreadyLinked: boolean };

/** For the "link an existing brand instead of creating a new one" picker
 * (req. for already-existing CRM companies). Brands already linked to any
 * company are still shown, just flagged — transparency over hiding, the
 * unique index is the actual enforcement if one is picked anyway. */
export async function listLinkableBrands(): Promise<LinkableBrand[]> {
  await assertSuperuser();
  const [brands, linkedAccounts] = await Promise.all([
    metricoolProvider.listBrands(),
    companySocialAccountsRepo.listByPlatforms([...METRICOOL_PLATFORMS]),
  ]);
  const linkedBlogIds = new Set(linkedAccounts.map((a) => a.externalPageId));
  return brands.map((b) => ({ blogId: String(b.id), label: b.label || b.title || `Brand ${b.id}`, alreadyLinked: linkedBlogIds.has(String(b.id)) }));
}

/** Links an existing Metricool brand to a company that doesn't have one yet
 * — the explicit, human-confirmed alternative to auto-creating a duplicate
 * (see the "possible_duplicate" result from autoProvisionMetricoolBrand). */
export async function linkExistingBrand(companyId: string, blogId: string): Promise<void> {
  await assertSuperuser();
  const existing = await companySocialAccountsRepo.findByCompanyId(companyId);
  if (existing.some((row) => (METRICOOL_PLATFORMS as readonly string[]).includes(row.platform))) {
    throw new Error("This company already has a linked Metricool brand.");
  }
  await linkBrandRows(companyId, blogId);
}

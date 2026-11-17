"use server";

import { revalidatePath } from "next/cache";
import * as pipelineStagesService from "@/server/services/pipelineStages";
import * as companiesService from "@/server/services/companies";
import * as usersService from "@/server/services/users";
import * as metricoolOnboardingService from "@/server/services/metricoolOnboarding";
import * as whapiOnboardingService from "@/server/services/whapiOnboarding";
import * as emailOnboardingService from "@/server/services/emailOnboarding";
import * as smtpOnboardingService from "@/server/services/smtpOnboarding";
import type { SmtpImapInput } from "@/server/services/smtpOnboarding";
import * as zadarmaNumberOnboardingService from "@/server/services/zadarmaNumberOnboarding";
import * as zadarmaExtensionOnboardingService from "@/server/services/zadarmaExtensionOnboarding";
import { UnauthorizedError } from "@/server/services/authorization";
import type { RoleKey, ModuleKey } from "@/server/constants";

export type ActionResult = { error?: string; ok?: true };

export async function createCompanyAction(name: string): Promise<ActionResult> {
  try {
    await companiesService.createCompany(name);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "Only Superusers can add companies." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

/** DB-only status (no Metricool call) for every given company at once —
 * safe to call on every Configuración page load. */
export async function getMetricoolProvisioningStatusAction(companyIds: string[]) {
  try {
    return { statuses: await metricoolOnboardingService.getProvisioningStatusForCompanies(companyIds) };
  } catch {
    return { statuses: [] as metricoolOnboardingService.CompanyProvisioningStatus[] };
  }
}

/** Live Metricool call — only invoked when the user explicitly asks (e.g. a
 * "Check status" button), never on page load. */
export async function getLiveMetricoolConnectionStatusAction(companyId: string) {
  try {
    return await metricoolOnboardingService.getLiveConnectionStatus(companyId);
  } catch (e) {
    const error = e instanceof UnauthorizedError || e instanceof Error ? e.message : "Unknown error.";
    return { provisioned: false as const, error };
  }
}

export async function retryMetricoolProvisioningAction(
  companyId: string
): Promise<ActionResult & { blogId?: string }> {
  const result = await metricoolOnboardingService.retryProvisioning(companyId).catch((e) => {
    if (e instanceof UnauthorizedError || e instanceof Error) return { ok: false as const, reason: "error" as const, message: e.message };
    throw e;
  });
  if (!result.ok) return { error: result.message };
  revalidatePath("/configuracion");
  return { ok: true, blogId: result.blogId };
}

export async function generateMetricoolConnectionLinkAction(
  companyId: string
): Promise<ActionResult & { link?: string; expiresAt?: string | null }> {
  try {
    const result = await metricoolOnboardingService.generateConnectionLink(companyId);
    return { ok: true, link: result.link, expiresAt: result.expiresAt };
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
}

export async function listLinkableMetricoolBrandsAction() {
  try {
    return { brands: await metricoolOnboardingService.listLinkableBrands() };
  } catch (e) {
    const error = e instanceof UnauthorizedError || e instanceof Error ? e.message : "Unknown error.";
    return { brands: [] as metricoolOnboardingService.LinkableBrand[], error };
  }
}

export async function linkExistingMetricoolBrandAction(companyId: string, blogId: string): Promise<ActionResult> {
  try {
    await metricoolOnboardingService.linkExistingBrand(companyId, blogId);
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

/** DB-only status (no Whapi call) for every given company at once — safe on
 * every Configuración page load, mirroring getMetricoolProvisioningStatusAction. */
export async function getWhapiProvisioningStatusAction(companyIds: string[]) {
  try {
    return { statuses: await whapiOnboardingService.getProvisioningStatusForCompanies(companyIds) };
  } catch {
    return { statuses: [] as whapiOnboardingService.CompanyChannelStatus[] };
  }
}

/** The on-demand, Superuser-only, pay-per-channel creation button — never
 * called automatically (see whapiOnboarding.ts's doc comment on why this is
 * deliberately not wired into createCompanyAction the way Metricool is). */
export async function createWhapiChannelAction(companyId: string): Promise<ActionResult & { channelId?: string }> {
  const result = await whapiOnboardingService.createChannelForCompany(companyId).catch((e) => {
    if (e instanceof UnauthorizedError || e instanceof Error) return { ok: false as const, reason: "error" as const, message: e.message };
    throw e;
  });
  if (!result.ok) return { error: result.message };
  revalidatePath("/configuracion");
  return { ok: true, channelId: result.channelId };
}

export async function retryWhapiChannelCreationAction(companyId: string): Promise<ActionResult & { channelId?: string }> {
  const result = await whapiOnboardingService.retryChannelCreation(companyId).catch((e) => {
    if (e instanceof UnauthorizedError || e instanceof Error) return { ok: false as const, reason: "error" as const, message: e.message };
    throw e;
  });
  if (!result.ok) return { error: result.message };
  revalidatePath("/configuracion");
  return { ok: true, channelId: result.channelId };
}

/** The explicit "I checked the Whapi dashboard, no duplicate channel exists"
 * confirmation — the only way out of FAILED_NEEDS_MANUAL_CHECK (see
 * whapiOnboarding.ts). Never triggered automatically. */
export async function confirmNoWhapiChannelWasCreatedAction(companyId: string): Promise<ActionResult> {
  const result = await whapiOnboardingService.confirmNoChannelWasCreated(companyId).catch((e) => {
    if (e instanceof UnauthorizedError || e instanceof Error) return { ok: false, message: e.message };
    throw e;
  });
  if (!result.ok) return { error: result.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function getLiveWhapiChannelStatusAction(companyId: string) {
  try {
    return await whapiOnboardingService.getLiveChannelStatus(companyId);
  } catch (e) {
    const error = e instanceof UnauthorizedError || e instanceof Error ? e.message : "Unknown error.";
    return { provisioned: false as const, error };
  }
}

/** Returns only a QR image for the browser to render — the decrypted
 * channel token itself never leaves whapiOnboardingService.getQrForCompany. */
export async function getWhapiQrAction(companyId: string) {
  try {
    return await whapiOnboardingService.getQrForCompany(companyId);
  } catch (e) {
    const message = e instanceof UnauthorizedError || e instanceof Error ? e.message : "Unknown error.";
    return { ok: false as const, message };
  }
}

/** Returns the Google consent-screen URL for a "Connect Gmail" button to
 * redirect the browser to — the button itself is not yet built (see
 * emailOnboarding.ts's module comment on this increment's deferred scope);
 * exposed now so the backend half of the flow is independently callable
 * and testable ahead of that UI work. */
export async function getGoogleAuthorizationUrlAction(companyId: string): Promise<ActionResult & { url?: string }> {
  const result = await emailOnboardingService.startAuthorization(companyId).catch((e) => {
    if (e instanceof UnauthorizedError || e instanceof Error) return { ok: false as const, message: e.message };
    throw e;
  });
  if (!result.ok) return { error: result.message };
  return { ok: true, url: result.url };
}

export type GoogleEmailAccountRow = {
  id: string;
  emailAddress: string;
  displayName: string | null;
  status: string;
  lastError: string | null;
  createdAt: string;
};

/** Maps the repository's full row down to a safe DTO before it ever
 * crosses the server/client boundary — deliberately excludes
 * encryptedRefreshToken/encryptedAccessToken/grantedScopes/historyId/
 * watchExpiration, none of which the browser has any legitimate reason to
 * receive, same "never return the secret, only what the UI needs to
 * render" convention as getWhapiQrAction (which returns just the rendered
 * QR image, never the channel's token). */
export async function getGoogleEmailAccountsForCompanyAction(companyId: string): Promise<{ accounts: GoogleEmailAccountRow[] }> {
  try {
    const accounts = await emailOnboardingService.listAccountsForCompany(companyId);
    // Filter here, in the action, rather than touching listAccountsForCompany
    // itself — that function now also returns SMTP_IMAP rows (same
    // company_email_accounts table), and this specific action/UI section is
    // Gmail-only; the new webmail section below has its own, separately
    // filtered action instead of this one being made to serve both.
    return {
      accounts: accounts
        .filter((a) => a.provider === "GOOGLE_WORKSPACE")
        .map((a) => ({
          id: a.id,
          emailAddress: a.emailAddress,
          displayName: a.displayName,
          status: a.status,
          lastError: a.lastError,
          createdAt: a.createdAt.toISOString(),
        })),
    };
  } catch {
    return { accounts: [] };
  }
}

export async function disconnectGoogleEmailAccountAction(accountId: string): Promise<ActionResult> {
  try {
    await emailOnboardingService.disconnectAccount(accountId);
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

/** "Test connection" button's action — runs both SMTP and IMAP login
 * attempts for real, before anything is saved. Never persists anything
 * itself; see connectWebmailAccountAction below for the actual save step
 * (which re-verifies independently rather than trusting this call's
 * result, per smtpOnboarding.ts's own doc comment). */
export async function testWebmailConnectionAction(input: SmtpImapInput): Promise<ActionResult> {
  const result = await smtpOnboardingService.testConnection(input);
  if (result.ok) return { ok: true };
  const parts = [result.smtpError && `SMTP: ${result.smtpError}`, result.imapError && `IMAP: ${result.imapError}`].filter(Boolean);
  return { error: parts.join(" — ") || "Could not connect with the provided details." };
}

export async function connectWebmailAccountAction(companyId: string, input: SmtpImapInput): Promise<ActionResult> {
  const result = await smtpOnboardingService.connectAccount(companyId, input).catch((e) => {
    if (e instanceof UnauthorizedError || e instanceof Error) return { ok: false as const, reason: "connection_failed" as const, message: e.message };
    throw e;
  });
  if (!result.ok) return { error: result.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export type WebmailAccountRow = {
  id: string;
  emailAddress: string;
  displayName: string | null;
  status: string;
  lastError: string | null;
  smtpHost: string | null;
  imapHost: string | null;
  createdAt: string;
};

/** Same safe-DTO convention as getGoogleEmailAccountsForCompanyAction —
 * deliberately excludes encryptedPassword, smtpImapUsername, and the raw
 * ports/security settings the UI doesn't need to re-display after the
 * fact; smtpHost/imapHost are included only as a "which server is this"
 * label for the list, never enough on their own to reconnect. */
export async function getWebmailAccountsForCompanyAction(companyId: string): Promise<{ accounts: WebmailAccountRow[] }> {
  try {
    const accounts = await smtpOnboardingService.listAccountsForCompany(companyId);
    return {
      accounts: accounts
        .filter((a) => a.provider === "SMTP_IMAP")
        .map((a) => ({
          id: a.id,
          emailAddress: a.emailAddress,
          displayName: a.displayName,
          status: a.status,
          lastError: a.lastError,
          smtpHost: a.smtpHost,
          imapHost: a.imapHost,
          createdAt: a.createdAt.toISOString(),
        })),
    };
  } catch {
    return { accounts: [] };
  }
}

export async function disconnectWebmailAccountAction(accountId: string): Promise<ActionResult> {
  try {
    await smtpOnboardingService.disconnectAccount(accountId);
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function createUserAction(input: {
  fullName: string;
  email: string;
  password: string;
  roleKey: RoleKey;
  companyIds: string[];
  modules: ModuleKey[];
}): Promise<ActionResult> {
  try {
    await usersService.createUser(input);
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

/** Director's own scoped user list — Managers/Agents in their own company
 * only (see usersService.listUsersForDirector). */
export async function listUsersForDirectorAction() {
  try {
    return { users: await usersService.listUsersForDirector() };
  } catch {
    return { users: [] };
  }
}

export async function toggleStageActiveAction(stageId: string): Promise<ActionResult> {
  try {
    await pipelineStagesService.toggleStageActive(stageId);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "Only Superusers can manage pipeline stages." };
    throw e;
  }
  revalidatePath("/configuracion");
  revalidatePath("/crm");
  return { ok: true };
}

export async function moveStageAction(stageId: string, direction: "up" | "down"): Promise<ActionResult> {
  try {
    await pipelineStagesService.moveStage(stageId, direction);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "Only Superusers can manage pipeline stages." };
    throw e;
  }
  revalidatePath("/configuracion");
  revalidatePath("/crm");
  return { ok: true };
}

export async function getUserAccessAction(userId: string) {
  try {
    return await usersService.getUserAccess(userId);
  } catch {
    return { companyIds: [] as string[], modules: [] as ModuleKey[], isSuperuser: false };
  }
}

export async function updateUserPermissionsAction(input: {
  userId: string;
  companyIds: string[];
  modules: ModuleKey[];
}): Promise<ActionResult> {
  try {
    await usersService.updateUserPermissions(input);
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

/** "Reset by role" — see usersService.resetUserPermissionsToRoleDefault for
 * the authorization boundary and what it does/doesn't touch. Returns the
 * applied module list so the client can update its checkboxes without a
 * second getUserAccessAction round trip. */
export async function resetUserPermissionsToRoleDefaultAction(
  userId: string
): Promise<ActionResult & { modules?: ModuleKey[] }> {
  try {
    const modules = await usersService.resetUserPermissionsToRoleDefault(userId);
    revalidatePath("/configuracion");
    return { ok: true, modules };
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
}

export async function deactivateUserAction(userId: string): Promise<ActionResult> {
  try {
    await usersService.deactivateUser(userId);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "Only Superusers can delete users." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

/** Role changes stay Superuser-only — see usersService.updateUserRole.
 * Unlike permissions (company/module access), Directors are never granted
 * role-change rights: identity/role is a stronger privilege boundary than
 * what modules someone can see inside a company they already belong to. */
export async function updateUserRoleAction(userId: string, roleKey: RoleKey): Promise<ActionResult> {
  try {
    await usersService.updateUserRole(userId, roleKey);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "Only Superusers can change roles." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  revalidatePath("/crm");
  return { ok: true };
}

export async function getManagersForCompanyAction(companyId: string) {
  try {
    return { users: await usersService.getManagersForCompany(companyId) };
  } catch {
    return { users: [] };
  }
}

export async function getAgentManagerAction(agentUserId: string, companyId: string) {
  try {
    return { managerUserId: await usersService.getAgentManager(agentUserId, companyId) };
  } catch {
    return { managerUserId: null };
  }
}

export async function getManagerTeamAction(managerUserId: string, companyId: string) {
  try {
    return { team: await usersService.getManagerTeam(managerUserId, companyId) };
  } catch {
    return { team: [] };
  }
}

export async function setAgentManagerAction(input: {
  agentUserId: string;
  companyId: string;
  managerUserId: string | null;
}): Promise<ActionResult> {
  try {
    await usersService.setAgentManager(input);
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Zadarma number purchasing — one shared Zadarma account, numbers bought and
// assigned per company directly from this page. See
// server/services/zadarmaNumberOnboarding.ts for the full safe-purchase
// design (PENDING-first inserts, FAILED vs FAILED_NEEDS_MANUAL_CHECK).
// -----------------------------------------------------------------------------

export type { CompanyZadarmaStatus as ZadarmaNumberStatus } from "@/server/services/zadarmaNumberOnboarding";

/** DB-only (no Zadarma call) status per company — safe on every
 * Configuración page load, same role as getWhapiProvisioningStatusAction. */
export async function getZadarmaNumberStatusAction(companyIds: string[]) {
  try {
    return { statuses: await zadarmaNumberOnboardingService.getProvisioningStatusForCompanies(companyIds) };
  } catch {
    return { statuses: [] as Awaited<ReturnType<typeof zadarmaNumberOnboardingService.getProvisioningStatusForCompanies>> };
  }
}

export type { ZadarmaErrorReason } from "@/server/services/zadarmaNumberOnboarding";

export async function getZadarmaCountriesAction() {
  try {
    return { countries: await zadarmaNumberOnboardingService.getCountries() };
  } catch (e) {
    const { reason, message } = zadarmaNumberOnboardingService.classifyError(e);
    return { countries: [], error: message, reason };
  }
}

export async function getZadarmaDestinationsAction(countryCodeIso: string) {
  try {
    return { destinations: await zadarmaNumberOnboardingService.getDestinations(countryCodeIso) };
  } catch (e) {
    const { reason, message } = zadarmaNumberOnboardingService.classifyError(e);
    return { destinations: [], error: message, reason };
  }
}

export async function getZadarmaAvailableNumbersAction(directionId: string, mask?: string) {
  try {
    return { numbers: await zadarmaNumberOnboardingService.searchAvailableNumbers(directionId, mask) };
  } catch (e) {
    const { reason, message } = zadarmaNumberOnboardingService.classifyError(e);
    return { numbers: [], error: message, reason };
  }
}

export async function checkZadarmaBalanceAction(destination: { connect_fee: string; monthly_fee: string; currency: string }) {
  return zadarmaNumberOnboardingService.checkSufficientBalance(destination);
}

export async function getZadarmaDocumentGroupsAction() {
  try {
    return { groups: await zadarmaNumberOnboardingService.getDocumentGroups() };
  } catch (e) {
    const { reason, message } = zadarmaNumberOnboardingService.classifyError(e);
    return { groups: [], error: message, reason };
  }
}

export async function createZadarmaDocumentGroupAction(fields: Record<string, string>): Promise<ActionResult & { groupId?: string }> {
  try {
    const result = await zadarmaNumberOnboardingService.createDocumentGroup(fields);
    return { ok: true, groupId: result.id };
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
}

/** The one paid action in this file — submits the actual order/ call after
 * the Superuser has seen pricing/terms and explicitly confirmed in the UI.
 * See zadarmaNumberOnboarding.ts's purchaseNumber for the duplicate-click
 * guard and ambiguous-failure handling this wraps. */
export async function purchaseZadarmaNumberAction(input: {
  companyId: string;
  countryCode: string;
  directionId: string;
  documentsGroupId: string;
  numberId?: string;
  monthlyFee: string | null;
  connectFee: string | null;
  currency: string | null;
}): Promise<ActionResult & { number?: string }> {
  const result = await zadarmaNumberOnboardingService.purchaseNumber(input).catch((e) => {
    if (e instanceof UnauthorizedError || e instanceof Error) return { ok: false as const, reason: "error" as const, message: e.message };
    throw e;
  });
  if (!result.ok) return { error: result.message };
  revalidatePath("/configuracion");
  return { ok: true, number: result.number };
}

export async function retryZadarmaPurchaseAction(
  numberRowId: string,
  input: { documentsGroupId: string; numberId?: string; monthlyFee: string | null; connectFee: string | null; currency: string | null }
): Promise<ActionResult & { number?: string }> {
  const result = await zadarmaNumberOnboardingService.retryPurchase(numberRowId, input).catch((e) => {
    if (e instanceof UnauthorizedError || e instanceof Error) return { ok: false as const, reason: "error" as const, message: e.message };
    throw e;
  });
  if (!result.ok) return { error: result.message };
  revalidatePath("/configuracion");
  return { ok: true, number: result.number };
}

/** The explicit "I checked the Zadarma dashboard, no unexpected charge
 * occurred" confirmation — the only way out of FAILED_NEEDS_MANUAL_CHECK.
 * Never triggered automatically. */
export async function confirmNoZadarmaChargeOccurredAction(numberRowId: string): Promise<ActionResult> {
  const result = await zadarmaNumberOnboardingService.confirmNoChargeOccurred(numberRowId).catch((e) => {
    if (e instanceof UnauthorizedError || e instanceof Error) return { ok: false, message: e.message };
    throw e;
  });
  if (!result.ok) return { error: result.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export type ZadarmaNumberRow = {
  id: string;
  number: string | null;
  companyId: string | null;
  status: string;
  monthlyFee: string | null;
  currency: string | null;
  lastError: string | null;
  createdAt: string;
};

/** Every number this CRM has ever attempted to purchase, for the "existing
 * numbers" management view (requirement #8) — including unassigned and
 * failed ones. Company names are resolved client-side from the companies
 * list the page already has, so this action stays a plain list fetch. */
export async function getZadarmaNumbersListAction(): Promise<{ numbers: ZadarmaNumberRow[] }> {
  try {
    const rows = await zadarmaNumberOnboardingService.listNumbers();
    return {
      numbers: rows.map((r) => ({
        id: r.id,
        number: r.number,
        companyId: r.companyId,
        status: r.status,
        monthlyFee: r.monthlyFee,
        currency: r.currency,
        lastError: r.lastError,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch {
    return { numbers: [] };
  }
}

/** Pure CRM-side routing change — no Zadarma API call, safe anytime. Pass
 * companyId: null to unassign a number entirely. */
export async function reassignZadarmaNumberAction(numberRowId: string, companyId: string | null): Promise<ActionResult> {
  try {
    await zadarmaNumberOnboardingService.reassignNumber(numberRowId, companyId);
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

/** "Add Existing Number" — Feature 2. Verifies ownership via Zadarma's
 * real, read-only owned-numbers API before linking; never purchases
 * anything. See zadarmaNumberOnboarding.ts's linkExistingNumber. */
export async function linkExistingZadarmaNumberAction(number: string, companyId: string): Promise<zadarmaNumberOnboardingService.LinkExistingNumberResult> {
  try {
    const result = await zadarmaNumberOnboardingService.linkExistingNumber({ number, companyId });
    if (result.ok) revalidatePath("/configuracion");
    return result;
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, reason: "unauthorized", message: "Only Superusers can manage Zadarma numbers." };
    const message = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, reason: "error", message };
  }
}

// ---------------------------------------------------------------------------
// Zadarma SIP/PBX extension management — real integration, gated behind
// ZADARMA_LIVE_PBX_PROVISIONING server-side (see zadarma.ts). No action here
// has a "mock" variant; createZadarmaExtensionAction calls the exact same
// real code path either way, and simply surfaces a clear
// "provisioning_disabled" result while the gate is off, instead of silently
// doing nothing or faking a success.
// ---------------------------------------------------------------------------

export type ZadarmaExtensionRow = {
  id: string;
  sipExtension: string | null;
  callerIdNumber: string | null;
  companyId: string | null;
  userId: string | null;
  status: string;
  lastError: string | null;
  createdAt: string;
};

export type ZadarmaExtensionErrorReason = zadarmaExtensionOnboardingService.ZadarmaExtensionErrorReason;

export async function getZadarmaExtensionLimitCheckAction() {
  try {
    const check = await zadarmaExtensionOnboardingService.checkExtensionLimits();
    return { ...check, error: undefined, reason: undefined as ZadarmaExtensionErrorReason | undefined };
  } catch (e) {
    const { reason, message } = zadarmaExtensionOnboardingService.classifyError(e);
    return { liveProvisioningEnabled: false, existingExtensionCount: 0, existingExtensionNumbers: [] as number[], error: message, reason };
  }
}

export async function getZadarmaExtensionsListAction(): Promise<{ extensions: ZadarmaExtensionRow[] }> {
  try {
    const rows = await zadarmaExtensionOnboardingService.listExtensions();
    return {
      extensions: rows.map((r) => ({
        id: r.id,
        sipExtension: r.sipExtension,
        callerIdNumber: r.callerIdNumber,
        companyId: r.companyId,
        userId: r.userId,
        status: r.status,
        lastError: r.lastError,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch {
    return { extensions: [] };
  }
}

export async function getZadarmaAssignableAgentsAction(companyId: string) {
  try {
    const agents = await zadarmaExtensionOnboardingService.getAssignableAgents(companyId);
    return { agents: agents.map((a) => ({ id: a.id, fullName: a.fullName })), error: undefined };
  } catch (e) {
    const { message } = zadarmaExtensionOnboardingService.classifyError(e);
    return { agents: [] as { id: string; fullName: string }[], error: message };
  }
}

export type CreateZadarmaExtensionResult =
  | { ok: true; sipExtension: string }
  | { ok: false; reason: ZadarmaExtensionErrorReason | "already_exists" | "no_number" | "needs_manual_check"; message: string };

export async function createZadarmaExtensionAction(companyId: string, userId: string): Promise<CreateZadarmaExtensionResult> {
  try {
    const result = await zadarmaExtensionOnboardingService.createExtensionForAgent({ companyId, userId });
    if (result.ok) {
      revalidatePath("/configuracion");
      return result;
    }
    return result;
  } catch (e) {
    const { reason, message } = zadarmaExtensionOnboardingService.classifyError(e);
    return { ok: false, reason, message };
  }
}

/** "Add Existing SIP" — Feature 1. Verifies the extension exists on the
 * real, connected Zadarma account (read-only) before linking; never
 * creates anything, never changes its Caller ID or password on Zadarma's
 * side. See zadarmaExtensionOnboarding.ts's connectExistingExtension. */
export async function connectExistingZadarmaExtensionAction(
  companyId: string,
  userId: string,
  sipExtension: string,
  sipPassword: string
): Promise<zadarmaExtensionOnboardingService.ConnectExistingExtensionResult> {
  try {
    const result = await zadarmaExtensionOnboardingService.connectExistingExtension({ companyId, userId, sipExtension, sipPassword });
    if (result.ok) revalidatePath("/configuracion");
    return result;
  } catch (e) {
    const { reason, message } = zadarmaExtensionOnboardingService.classifyError(e);
    return { ok: false, reason, message };
  }
}

export async function retryZadarmaExtensionAction(extensionRowId: string): Promise<CreateZadarmaExtensionResult> {
  try {
    const result = await zadarmaExtensionOnboardingService.retryCreateExtension(extensionRowId);
    if (result.ok) revalidatePath("/configuracion");
    return result;
  } catch (e) {
    const { reason, message } = zadarmaExtensionOnboardingService.classifyError(e);
    return { ok: false, reason, message };
  }
}

export async function confirmNoZadarmaExtensionChargeAction(extensionRowId: string): Promise<ActionResult> {
  try {
    const result = await zadarmaExtensionOnboardingService.confirmNoExtensionChargeOccurred(extensionRowId);
    if (!result.ok) return { error: result.message };
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function reassignZadarmaExtensionAction(extensionRowId: string, newCompanyId: string, newUserId: string): Promise<ActionResult> {
  try {
    const result = await zadarmaExtensionOnboardingService.reassignExtension(extensionRowId, newCompanyId, newUserId);
    if (!result.ok) return { error: result.message };
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function revokeZadarmaExtensionAction(extensionRowId: string): Promise<ActionResult> {
  try {
    const result = await zadarmaExtensionOnboardingService.revokeExtension(extensionRowId);
    if (!result.ok) return { error: result.message };
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

/** See zadarmaExtensionOnboarding.ts's reactivateExtension doc comment for
 * what this can and can't do — restores a REVOKED row in place, never
 * creates a new one, never writes anything to the real Zadarma account. */
export async function reactivateZadarmaExtensionAction(extensionRowId: string): Promise<ActionResult> {
  try {
    const result = await zadarmaExtensionOnboardingService.reactivateExtension(extensionRowId);
    if (!result.ok) return { error: result.message };
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

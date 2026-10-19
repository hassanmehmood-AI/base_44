"use server";

import { revalidatePath } from "next/cache";
import * as pipelineStagesService from "@/server/services/pipelineStages";
import * as companiesService from "@/server/services/companies";
import * as usersService from "@/server/services/users";
import * as metricoolOnboardingService from "@/server/services/metricoolOnboarding";
import * as whapiOnboardingService from "@/server/services/whapiOnboarding";
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

"use server";

import { revalidatePath } from "next/cache";
import * as pipelineStagesService from "@/server/services/pipelineStages";
import * as companiesService from "@/server/services/companies";
import * as usersService from "@/server/services/users";
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

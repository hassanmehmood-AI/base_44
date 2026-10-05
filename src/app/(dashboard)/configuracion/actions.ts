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
    if (e instanceof UnauthorizedError) return { error: "Only Superusers can add users." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
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
    if (e instanceof UnauthorizedError) return { error: "Only Superusers can edit permissions." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/configuracion");
  return { ok: true };
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

"use server";

import { revalidatePath } from "next/cache";
import * as pipelineStagesService from "@/server/services/pipelineStages";
import { UnauthorizedError } from "@/server/services/authorization";

export type ActionResult = { error?: string; ok?: true };

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

import * as pipelineStagesRepo from "@/server/repositories/pipelineStages";
import { requireSession, UnauthorizedError } from "@/server/services/authorization";

export async function getDefaultPipelineStages() {
  await requireSession(); // no data here is company-scoped, but still session-gated
  return pipelineStagesRepo.findDefaultPipelineStages();
}

export async function getActiveDefaultPipelineStages() {
  const all = await getDefaultPipelineStages();
  return all.filter((s) => s.isActive);
}

/** Pipeline stages are global (shared across every company, per the v1 schema
 * decision), so only a Superuser may reorder or activate/deactivate them —
 * not something any single company's agent should be able to affect for
 * everyone else. */
async function requireSuperuser() {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") {
    throw new UnauthorizedError("Only Superusers can manage pipeline stages.");
  }
  return session;
}

export async function toggleStageActive(stageId: string) {
  await requireSuperuser();
  const stage = await pipelineStagesRepo.findById(stageId);
  if (!stage) throw new Error("Stage not found.");
  return pipelineStagesRepo.setActive(stageId, !stage.isActive);
}

export async function moveStage(stageId: string, direction: "up" | "down") {
  await requireSuperuser();
  const stages = await pipelineStagesRepo.findDefaultPipelineStages(); // ordered by position
  const idx = stages.findIndex((s) => s.id === stageId);
  if (idx === -1) throw new Error("Stage not found.");
  const neighborIdx = direction === "up" ? idx - 1 : idx + 1;
  if (neighborIdx < 0 || neighborIdx >= stages.length) return; // already at the boundary — no-op
  const current = stages[idx];
  const neighbor = stages[neighborIdx];
  await pipelineStagesRepo.swapPositions(current.id, current.position, neighbor.id, neighbor.position);
}

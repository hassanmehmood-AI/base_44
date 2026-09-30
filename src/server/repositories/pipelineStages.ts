import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { pipelines, pipelineStages } from "@/db/schema";

export type PipelineStage = typeof pipelineStages.$inferSelect;

/** v1 uses a single shared global pipeline (companyId is null) — see the
 * approved Phase 2 schema decision. */
export async function findDefaultPipelineStages(): Promise<PipelineStage[]> {
  const db = getDb();
  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.isDefault, true)).limit(1);
  if (!pipeline) return [];
  return db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipeline.id))
    .orderBy(pipelineStages.position);
}

export async function findById(id: string): Promise<PipelineStage | undefined> {
  const [row] = await getDb().select().from(pipelineStages).where(eq(pipelineStages.id, id)).limit(1);
  return row;
}

export async function setActive(id: string, isActive: boolean): Promise<PipelineStage> {
  const [row] = await getDb().update(pipelineStages).set({ isActive }).where(eq(pipelineStages.id, id)).returning();
  return row;
}

/** Swaps the `position` of two stages atomically — used to move a stage up/down
 * one slot in the admin ordering screen. */
export async function swapPositions(idA: string, positionA: number, idB: string, positionB: number): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.update(pipelineStages).set({ position: positionB }).where(eq(pipelineStages.id, idA));
    await tx.update(pipelineStages).set({ position: positionA }).where(eq(pipelineStages.id, idB));
  });
}

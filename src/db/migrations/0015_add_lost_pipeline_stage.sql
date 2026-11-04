-- Adds the "Lost" outcome to the shared default pipeline (lead management
-- workflow Step 3 — see src/lib/pipeline.ts's LOST_STAGE_KEYS). Pure data
-- migration, no schema change: pipeline_stages already supports an
-- arbitrary key/position/isActive row, so this is a single INSERT rather
-- than an ALTER TABLE. Scoped to the default pipeline only (is_default =
-- true), matching every other pipeline-stage read in this app (see
-- pipelineStagesRepo.findDefaultPipelineStages). Looked up dynamically via
-- SQL rather than hardcoding a pipeline id, since that id is generated at
-- seed time and differs per environment. ON CONFLICT DO NOTHING on the
-- existing (pipeline_id, key) unique index makes this safe to re-run.
INSERT INTO "pipeline_stages" ("id", "pipeline_id", "key", "position", "is_active")
SELECT
  gen_random_uuid(),
  p."id",
  'PERDIDO',
  COALESCE((SELECT MAX("position") FROM "pipeline_stages" WHERE "pipeline_id" = p."id"), -1) + 1,
  true
FROM "pipelines" p
WHERE p."is_default" = true
ON CONFLICT ("pipeline_id", "key") DO NOTHING;

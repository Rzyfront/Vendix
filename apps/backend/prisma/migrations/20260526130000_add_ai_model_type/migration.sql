-- DATA IMPACT:
--   ai_engine_configs: ALTER (add model_type column). Backfill ~N rows from settings JSON
--     using the same heuristic as AIEngineService.getModelTypeFromSettings()
--     (settings.model_type / settings.modelType, image_* keys, modalities includes 'image',
--     fallback to 'text'). No row deletions.
--   ai_engine_applications: ALTER (add model_type column). Backfill ~N rows by copying
--     model_type from the associated ai_engine_configs row (via config_id), falling back to
--     output_format when it matches an enum value, otherwise 'text'. No row deletions.
--   Tables affected: ai_engine_configs, ai_engine_applications
--   Destructive operations: none
--   FK/cascade risk: none (no FK changes, no DELETE/UPDATE without WHERE)
--   Idempotency: guarded with IF NOT EXISTS, DO $$ EXCEPTION block, and WHERE model_type IS NULL
--   Approval: Phase A of approved plan
--     planning/ai-engine-model-type-formalization-plan.md

BEGIN;

-- 1. Create the enum type idempotently
DO $$ BEGIN
  CREATE TYPE ai_model_type_enum AS ENUM (
    'text',
    'image',
    'embedding',
    'audio',
    'video',
    'rerank',
    'speech',
    'transcription'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Add nullable columns first so backfill can run safely
ALTER TABLE ai_engine_configs
  ADD COLUMN IF NOT EXISTS model_type ai_model_type_enum;

ALTER TABLE ai_engine_applications
  ADD COLUMN IF NOT EXISTS model_type ai_model_type_enum;

-- 3. Backfill ai_engine_configs.model_type
--    Mirrors AIEngineService.getModelTypeFromSettings():
--      a) settings.model_type / settings.modelType if it is a valid AIModelType
--      b) image inference via image_generation_mode / image_endpoint / image_model
--         or modalities array containing 'image'
--      c) default 'text'
UPDATE ai_engine_configs
SET model_type = CASE
  WHEN settings->>'model_type' IN (
    'text','image','embedding','audio','video','rerank','speech','transcription'
  ) THEN (settings->>'model_type')::ai_model_type_enum
  WHEN settings->>'modelType' IN (
    'text','image','embedding','audio','video','rerank','speech','transcription'
  ) THEN (settings->>'modelType')::ai_model_type_enum
  WHEN settings ? 'image_generation_mode'
    OR settings ? 'image_endpoint'
    OR settings ? 'image_model'
    OR (
      jsonb_typeof(settings->'modalities') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(settings->'modalities') AS m(v)
        WHERE m.v = 'image'
      )
    )
    THEN 'image'::ai_model_type_enum
  ELSE 'text'::ai_model_type_enum
END
WHERE model_type IS NULL;

-- 4. Backfill ai_engine_applications.model_type
--    Copy from associated config when present; otherwise infer from output_format;
--    fallback 'text'.
UPDATE ai_engine_applications a
SET model_type = COALESCE(
  (SELECT c.model_type FROM ai_engine_configs c WHERE c.id = a.config_id),
  CASE
    WHEN a.output_format IN (
      'image','embedding','audio','video','rerank','speech','transcription'
    ) THEN (a.output_format)::ai_model_type_enum
    ELSE 'text'::ai_model_type_enum
  END
)
WHERE a.model_type IS NULL;

-- 5. Lock down columns: default 'text' and NOT NULL after backfill
ALTER TABLE ai_engine_configs ALTER COLUMN model_type SET DEFAULT 'text';
ALTER TABLE ai_engine_configs ALTER COLUMN model_type SET NOT NULL;

ALTER TABLE ai_engine_applications ALTER COLUMN model_type SET DEFAULT 'text';
ALTER TABLE ai_engine_applications ALTER COLUMN model_type SET NOT NULL;

-- 6. Indexes for fast filtering by model_type
CREATE INDEX IF NOT EXISTS ai_engine_configs_model_type_idx
  ON ai_engine_configs (model_type);

CREATE INDEX IF NOT EXISTS ai_engine_applications_model_type_idx
  ON ai_engine_applications (model_type);

COMMIT;

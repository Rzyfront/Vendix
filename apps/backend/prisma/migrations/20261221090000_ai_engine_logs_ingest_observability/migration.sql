-- =====================================================
-- ai_engine_logs: por qué falló o se cortó una llamada de IA (ia-cargas F6)
-- =====================================================
-- DATA IMPACT:
-- Table affected: ai_engine_logs. ONLY three nullable ADD COLUMN.
-- Expected row changes: none. No backfill, no UPDATE/DELETE, no data rewrite;
--   existing rows keep NULL in the new columns.
-- Destructive operations: none (no DROP, no TRUNCATE, no type change, no
--   NOT NULL, no DEFAULT → PostgreSQL only touches the catalog, no table
--   rewrite and a brief ACCESS EXCLUSIVE lock).
-- FK/cascade risk: none (no constraints added or changed).
-- Index: none. The dashboard filters by created_at (existing
--   ai_engine_logs_created_at_idx) and groups by app_key (existing
--   ai_engine_logs_app_key_idx).
-- Idempotency: ADD COLUMN IF NOT EXISTS; re-running is a no-op.
-- Columns:
--   finish_reason    provider finish reason of the final answer ('stop',
--                    'length', 'tool_calls'); NULL when unknown or failed.
--   attempt          caller attempt of the call (ai-ingest: 1 first call,
--                    +1 per repair and per split level); NULL otherwise.
--   validation_error why ai-ingest rejected the answer (parse/ajv), cut to
--                    500 chars and without the model's text; NULL if valid.
-- Approval: ia-cargas plan F6 (additive migration on ai_engine_logs).

ALTER TABLE "ai_engine_logs"
  ADD COLUMN IF NOT EXISTS "finish_reason" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "attempt" INTEGER,
  ADD COLUMN IF NOT EXISTS "validation_error" VARCHAR(500);

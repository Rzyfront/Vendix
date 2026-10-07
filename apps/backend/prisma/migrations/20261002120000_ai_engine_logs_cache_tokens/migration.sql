-- DATA IMPACT: 0 filas modificadas
-- Tables affected: ai_engine_logs (2 columnas aditivas)
-- Expected row changes: none (ADD COLUMN with NOT NULL DEFAULT 0 backfills 0, no row rewrite semantics change)
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ADD COLUMN IF NOT EXISTS, re-runnable
-- Approval: plan docs/plans/vex-agent-remediation-plan.md paso 8

-- Measured prompt cache (remediation step 8): persist Anthropic
-- cache_read_input_tokens / cache_creation_input_tokens per AI request.
-- Additive only: no DROP, TRUNCATE, DELETE, UPDATE, or FK changes.
ALTER TABLE "ai_engine_logs" ADD COLUMN IF NOT EXISTS "cache_read_tokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_engine_logs" ADD COLUMN IF NOT EXISTS "cache_creation_tokens" INTEGER NOT NULL DEFAULT 0;

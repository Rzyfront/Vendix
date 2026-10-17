-- DATA IMPACT:
-- Tables affected: new ai_agent_trace_spans; ai_engine_logs receives nullable columns/indexes only.
-- Expected row changes: none; historical logs, quotas and business data are unchanged.
-- Destructive operations: none. No backfill, deletion, cascade, FK rewrite or enum change.
-- FK/cascade risk: none; trace identity is explicitly scoped and intentionally independent of domain lifecycle.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS; ADD COLUMN IF NOT EXISTS; guarded CHECK constraints.
-- Approval: approved phase-A brief, strictly additive/idempotent migration; do not apply to remote DBs.

CREATE TABLE IF NOT EXISTS "ai_agent_trace_spans" (
  "span_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "trace_id" UUID NOT NULL,
  "parent_span_id" UUID,
  "request_id" UUID NOT NULL,
  "objective_id" UUID,
  "conversation_id" VARCHAR(100),
  "turn_id" UUID,
  "provider_call_id" UUID,
  "attempt_id" UUID,
  "tool_call_id" UUID,
  "scope_kind" VARCHAR(10) NOT NULL,
  "system_purpose" VARCHAR(32),
  "organization_id" INTEGER,
  "store_id" INTEGER,
  "user_id" INTEGER,
  "surface" VARCHAR(20),
  "agent" VARCHAR(20),
  "kind" VARCHAR(32) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'started',
  "outcome" VARCHAR(32),
  "error_code" VARCHAR(100),
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMPTZ(6),
  "duration_ms" INTEGER,
  "prompt_tokens" INTEGER,
  "completion_tokens" INTEGER,
  "cache_read_tokens" INTEGER,
  "cache_creation_tokens" INTEGER,
  "cost_usd" DECIMAL(12,8),
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_trace_spans_pkey" PRIMARY KEY ("span_id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_trace_spans_scope_check' AND conrelid = 'ai_agent_trace_spans'::regclass) THEN
    ALTER TABLE "ai_agent_trace_spans" ADD CONSTRAINT "ai_agent_trace_spans_scope_check" CHECK (
      ("scope_kind" = 'tenant' AND "organization_id" IS NOT NULL AND "organization_id" > 0 AND "store_id" IS NOT NULL AND "store_id" > 0 AND ("user_id" IS NULL OR "user_id" > 0) AND "system_purpose" IS NULL)
      OR
      ("scope_kind" = 'system' AND "organization_id" IS NULL AND "store_id" IS NULL AND "user_id" IS NULL AND "system_purpose" IS NOT NULL AND "system_purpose" IN ('platform_knowledge', 'evaluation', 'maintenance'))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_trace_spans_cost_check' AND conrelid = 'ai_agent_trace_spans'::regclass) THEN
    ALTER TABLE "ai_agent_trace_spans" ADD CONSTRAINT "ai_agent_trace_spans_cost_check" CHECK ("cost_usd" IS NULL OR ("kind" = 'provider_attempt' AND "cost_usd" >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_trace_spans_usage_check' AND conrelid = 'ai_agent_trace_spans'::regclass) THEN
    ALTER TABLE "ai_agent_trace_spans" ADD CONSTRAINT "ai_agent_trace_spans_usage_check" CHECK (
      ("prompt_tokens" IS NULL OR "prompt_tokens" >= 0) AND ("completion_tokens" IS NULL OR "completion_tokens" >= 0)
      AND ("cache_read_tokens" IS NULL OR "cache_read_tokens" >= 0) AND ("cache_creation_tokens" IS NULL OR "cache_creation_tokens" >= 0)
      AND ("duration_ms" IS NULL OR "duration_ms" >= 0)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ai_agent_trace_spans_trace_id_started_at_idx" ON "ai_agent_trace_spans"("trace_id", "started_at");
CREATE INDEX IF NOT EXISTS "ai_agent_trace_spans_store_id_created_at_idx" ON "ai_agent_trace_spans"("store_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_agent_trace_spans_organization_id_created_at_idx" ON "ai_agent_trace_spans"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_agent_trace_spans_request_id_created_at_idx" ON "ai_agent_trace_spans"("request_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_agent_trace_spans_provider_call_id_idx" ON "ai_agent_trace_spans"("provider_call_id");
CREATE INDEX IF NOT EXISTS "ai_agent_trace_spans_kind_created_at_idx" ON "ai_agent_trace_spans"("kind", "created_at");

ALTER TABLE "ai_engine_logs"
  ADD COLUMN IF NOT EXISTS "trace_id" UUID,
  ADD COLUMN IF NOT EXISTS "span_id" UUID,
  ADD COLUMN IF NOT EXISTS "objective_id" UUID,
  ADD COLUMN IF NOT EXISTS "conversation_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "turn_id" UUID,
  ADD COLUMN IF NOT EXISTS "provider_call_id" UUID,
  ADD COLUMN IF NOT EXISTS "attempt_id" UUID,
  ADD COLUMN IF NOT EXISTS "tool_call_id" UUID,
  ADD COLUMN IF NOT EXISTS "external_request_id_hash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "usage_observed" JSONB,
  ADD COLUMN IF NOT EXISTS "cost_source" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "telemetry_metadata" JSONB;

CREATE INDEX IF NOT EXISTS "ai_engine_logs_request_id_created_at_idx" ON "ai_engine_logs"("request_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_engine_logs_trace_id_created_at_idx" ON "ai_engine_logs"("trace_id", "created_at");

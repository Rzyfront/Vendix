-- DATA IMPACT:
-- Tables affected: new ai_agent_objectives, ai_agent_tool_results, ai_agent_effects; nullable ai_agent_tasks.objective_id.
-- Expected row changes: none. No mass import, backfill or mutation of existing records.
-- Destructive operations: none. No DROP/TRUNCATE/DELETE/UPDATE/CASCADE.
-- FK/cascade risk: new references RESTRICT only; existing conversations/jobs are never cascade-deleted.
-- Idempotency: IF NOT EXISTS tables/indexes/column, pg_constraint guards for all added FKs/checks.
-- Locks: nullable column is metadata-only; existing-task index has a separate single-statement migration.
-- Existing-task FK is NOT VALID: protect new rows without scanning historical jobs.
-- Optional later validation in an approved window (never part of automatic deploy):
-- ALTER TABLE ai_agent_tasks VALIDATE CONSTRAINT ai_agent_tasks_objective_id_fkey;
-- No explicit transaction around concurrent indexes.
-- Approval: approved D1 brief. Review/apply only in an explicitly authorized environment; not executed here.

CREATE TABLE IF NOT EXISTS "ai_agent_objectives" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "store_id" INTEGER NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "conversation_id" INTEGER NOT NULL,
  "agent_id" VARCHAR(100),
  "legacy_plan_id" VARCHAR(100) NOT NULL,
  "goal" TEXT NOT NULL,
  "plan" JSONB,
  "entities" JSONB NOT NULL DEFAULT '[]',
  "step_hashes" JSONB,
  "next_step" TEXT,
  "semantic_status" VARCHAR(32) NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 1,
  "lease_generation" INTEGER NOT NULL DEFAULT 0,
  "lease_until" TIMESTAMPTZ(6),
  "budget" JSONB NOT NULL,
  "authority_snapshot" JSONB NOT NULL DEFAULT '[]',
  "requires_revalidation" BOOLEAN NOT NULL DEFAULT TRUE,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_objectives_legacy_uq" ON "ai_agent_objectives"("store_id","organization_id","user_id","conversation_id","legacy_plan_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_objectives_scope_uq" ON "ai_agent_objectives"("id","store_id","organization_id","user_id");
CREATE INDEX IF NOT EXISTS "ai_agent_objectives_owner_conversation_idx" ON "ai_agent_objectives"("store_id","organization_id","user_id","conversation_id");
CREATE INDEX IF NOT EXISTS "ai_agent_objectives_owner_status_expiry_idx" ON "ai_agent_objectives"("store_id","organization_id","user_id","semantic_status","expires_at");

CREATE TABLE IF NOT EXISTS "ai_agent_tool_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "store_id" INTEGER NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "objective_id" UUID NOT NULL,
  "task_id" INTEGER,
  "tool_call_id" VARCHAR(200) NOT NULL,
  "tool_name" VARCHAR(200) NOT NULL,
  "tool_version" VARCHAR(50) NOT NULL,
  "args_hash" VARCHAR(64) NOT NULL,
  "receipt" JSONB NOT NULL,
  "data" JSONB,
  "pagination" JSONB,
  "freshness" VARCHAR(20) NOT NULL,
  "resource_ids" JSONB NOT NULL,
  "evidence_refs" JSONB NOT NULL,
  "lease_generation" INTEGER,
  "stale_lease" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_tool_results_objective_id_tool_call_id_key" ON "ai_agent_tool_results"("objective_id","tool_call_id");
CREATE INDEX IF NOT EXISTS "ai_agent_tool_results_owner_page_idx" ON "ai_agent_tool_results"("store_id","organization_id","user_id","objective_id","created_at","id");
CREATE INDEX IF NOT EXISTS "ai_agent_tool_results_task_id_idx" ON "ai_agent_tool_results"("task_id");

CREATE TABLE IF NOT EXISTS "ai_agent_effects" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "store_id" INTEGER NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "objective_id" UUID NOT NULL,
  "operation_id" VARCHAR(200) NOT NULL,
  "proposal_hash" VARCHAR(64) NOT NULL,
  "step_id" VARCHAR(200) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'proposed',
  "domain_receipt" JSONB,
  "domain_reference" VARCHAR(300),
  "evidence_result_id" UUID,
  "history" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_effects_operation_id_key" ON "ai_agent_effects"("operation_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_effects_proposal_uq" ON "ai_agent_effects"("objective_id","step_id","proposal_hash");
CREATE INDEX IF NOT EXISTS "ai_agent_effects_owner_objective_status_idx" ON "ai_agent_effects"("store_id","organization_id","user_id","objective_id","status");
CREATE INDEX IF NOT EXISTS "ai_agent_effects_evidence_result_id_idx" ON "ai_agent_effects"("evidence_result_id");
ALTER TABLE "ai_agent_tasks" ADD COLUMN IF NOT EXISTS "objective_id" UUID;
-- Concurrent index ai_agent_tasks_objective_id_idx is isolated in 20261018110001_ai_agent_tasks_objective_index.


DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_agent_objectives_conversation_id_fkey' AND conrelid='ai_agent_objectives'::regclass) THEN
    ALTER TABLE "ai_agent_objectives" ADD CONSTRAINT "ai_agent_objectives_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_agent_objectives_scope_check' AND conrelid='ai_agent_objectives'::regclass) THEN
    ALTER TABLE "ai_agent_objectives" ADD CONSTRAINT "ai_agent_objectives_scope_check" CHECK ("store_id">0 AND "organization_id">0 AND "user_id">0 AND "version">0 AND "lease_generation">=0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_agent_objectives_status_check' AND conrelid='ai_agent_objectives'::regclass) THEN
    ALTER TABLE "ai_agent_objectives" ADD CONSTRAINT "ai_agent_objectives_status_check" CHECK ("semantic_status" IN ('active','paused','awaiting_approval','awaiting_input','partial','blocked','unknown_effect','expired','superseded','cancelled','completed_verified','failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_agent_tool_results_objective_scope_fkey' AND conrelid='ai_agent_tool_results'::regclass) THEN
    ALTER TABLE "ai_agent_tool_results" ADD CONSTRAINT "ai_agent_tool_results_objective_scope_fkey" FOREIGN KEY ("objective_id","store_id","organization_id","user_id") REFERENCES "ai_agent_objectives"("id","store_id","organization_id","user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_agent_tool_results_task_id_fkey' AND conrelid='ai_agent_tool_results'::regclass) THEN
    ALTER TABLE "ai_agent_tool_results" ADD CONSTRAINT "ai_agent_tool_results_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "ai_agent_tasks"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_agent_tool_results_freshness_check' AND conrelid='ai_agent_tool_results'::regclass) THEN
    ALTER TABLE "ai_agent_tool_results" ADD CONSTRAINT "ai_agent_tool_results_freshness_check" CHECK ("freshness" IN ('observed','unknown','truncated') AND ("lease_generation" IS NULL OR "lease_generation">=0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_agent_effects_objective_scope_fkey' AND conrelid='ai_agent_effects'::regclass) THEN
    ALTER TABLE "ai_agent_effects" ADD CONSTRAINT "ai_agent_effects_objective_scope_fkey" FOREIGN KEY ("objective_id","store_id","organization_id","user_id") REFERENCES "ai_agent_objectives"("id","store_id","organization_id","user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_agent_effects_evidence_result_id_fkey' AND conrelid='ai_agent_effects'::regclass) THEN
    ALTER TABLE "ai_agent_effects" ADD CONSTRAINT "ai_agent_effects_evidence_result_id_fkey" FOREIGN KEY ("evidence_result_id") REFERENCES "ai_agent_tool_results"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_agent_effects_status_check' AND conrelid='ai_agent_effects'::regclass) THEN
    ALTER TABLE "ai_agent_effects" ADD CONSTRAINT "ai_agent_effects_status_check" CHECK ("status" IN ('proposed','approved','applying','applied','verified','unknown','failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_agent_tasks_objective_id_fkey' AND conrelid='ai_agent_tasks'::regclass) THEN
    ALTER TABLE "ai_agent_tasks" ADD CONSTRAINT "ai_agent_tasks_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "ai_agent_objectives"("id") ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;
  END IF;
END $$;

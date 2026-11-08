-- AI inside Flows (flujos-adm P6).
-- P6.3: one row per AI call made for Flows (AI step, AI step test, document
--   read, weekly summary), so the owner sees tokens per store and per flow.
--   The plan limits are NOT changed (decision D4): the quota stays the plan's
--   `text_generation.monthly_tokens_cap`; this table only attributes usage.
-- P6.4: AI narrative of the Flows analytics, one weekly row per store (plus
--   on-demand rows), with the validated content and the tokens it used.
--
-- DATA IMPACT:
-- Tables affected: workflow_ai_usage (new), workflow_ai_summaries (new)
-- Expected row changes: none (new empty tables)
-- Destructive operations: none
-- FK/cascade risk: none. store_id -> stores ON DELETE RESTRICT; definition_id,
--   instance_id and created_by_user_id ON DELETE SET NULL (deleting a flow, a
--   request or a user never deletes usage or summaries).
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS and pg_constraint checks.

CREATE TABLE IF NOT EXISTS "workflow_ai_usage" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "definition_id" INTEGER,
  "instance_id" INTEGER,
  "stage_key" VARCHAR(80),
  "purpose" VARCHAR(32) NOT NULL,
  "app_key" VARCHAR(100),
  "model" VARCHAR(100),
  "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
  "completion_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_ai_usage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "workflow_ai_usage_store_id_created_at_idx"
  ON "workflow_ai_usage"("store_id", "created_at");
CREATE INDEX IF NOT EXISTS "workflow_ai_usage_store_id_definition_id_created_at_idx"
  ON "workflow_ai_usage"("store_id", "definition_id", "created_at");

CREATE TABLE IF NOT EXISTS "workflow_ai_summaries" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "period_from" DATE NOT NULL,
  "period_to" DATE NOT NULL,
  "week_key" VARCHAR(10),
  "status" VARCHAR(20) NOT NULL,
  "content" JSONB,
  "metrics" JSONB,
  "model" VARCHAR(100),
  "tokens_used" INTEGER NOT NULL DEFAULT 0,
  "error" VARCHAR(500),
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_ai_summaries_pkey" PRIMARY KEY ("id")
);

-- One weekly summary per store and ISO week; manual rows carry NULL week_key.
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_ai_summaries_store_id_week_key_key"
  ON "workflow_ai_summaries"("store_id", "week_key");
CREATE INDEX IF NOT EXISTS "workflow_ai_summaries_store_id_created_at_idx"
  ON "workflow_ai_summaries"("store_id", "created_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_ai_usage_store_id_fkey') THEN
    ALTER TABLE "workflow_ai_usage"
      ADD CONSTRAINT "workflow_ai_usage_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_ai_usage_definition_id_fkey') THEN
    ALTER TABLE "workflow_ai_usage"
      ADD CONSTRAINT "workflow_ai_usage_definition_id_fkey"
      FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_ai_usage_instance_id_fkey') THEN
    ALTER TABLE "workflow_ai_usage"
      ADD CONSTRAINT "workflow_ai_usage_instance_id_fkey"
      FOREIGN KEY ("instance_id") REFERENCES "workflow_instances"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_ai_summaries_store_id_fkey') THEN
    ALTER TABLE "workflow_ai_summaries"
      ADD CONSTRAINT "workflow_ai_summaries_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_ai_summaries_created_by_user_id_fkey') THEN
    ALTER TABLE "workflow_ai_summaries"
      ADD CONSTRAINT "workflow_ai_summaries_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Production operation of Flows (flujos-adm P7).
-- P7.1: per-plan limits for Flows (`subscription_plans.workflow_limits`, NULL =
--   platform defaults) and monthly usage counters per store
--   (`workflow_usage_counters`). AI tokens keep the plan's current cap (D4).
-- P7.2: immutable audit trail of definitions, decisions, document accesses and
--   secrets (`workflow_audit_log`), append-only by trigger, hash-chained per
--   store.
-- P7.3: per-flow and per-stage permissions (`workflow_definitions.access`,
--   NULL = open, today's behaviour).
-- P7.4: outbox processing timestamp for latency metrics
--   (`workflow_outbox.processed_at`) and platform alert history
--   (`workflow_ops_alerts`).
-- P7.6: full per-store export jobs (`workflow_exports`).
--
-- DATA IMPACT:
-- Tables affected: subscription_plans (+ nullable column), workflow_definitions
--   (+ nullable column), workflow_outbox (+ nullable column), new tables
--   workflow_usage_counters, workflow_audit_log, workflow_ops_alerts,
--   workflow_exports.
-- Expected row changes: none (new columns are NULL; new tables are empty).
-- Destructive operations: none.
-- FK/cascade risk: none. store_id -> stores ON DELETE RESTRICT; user and
--   optional store references ON DELETE SET NULL. No CASCADE.
-- Idempotency: ADD COLUMN / CREATE TABLE / CREATE INDEX IF NOT EXISTS,
--   pg_constraint and pg_trigger checks, CREATE OR REPLACE FUNCTION.

-- ── P7.1 ────────────────────────────────────────────────────────────────────
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "workflow_limits" JSONB;

CREATE TABLE IF NOT EXISTS "workflow_usage_counters" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "period" CHAR(7) NOT NULL,
  "metric" VARCHAR(40) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_usage_counters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_usage_counters_store_id_period_metric_key"
  ON "workflow_usage_counters"("store_id", "period", "metric");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_usage_counters_store_id_fkey') THEN
    ALTER TABLE "workflow_usage_counters" ADD CONSTRAINT "workflow_usage_counters_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ── P7.2 ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "workflow_audit_log" (
  "id" BIGSERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "seq" BIGINT NOT NULL,
  "category" VARCHAR(20) NOT NULL,
  "action" VARCHAR(60) NOT NULL,
  "actor_type" VARCHAR(20) NOT NULL,
  "actor_id" INTEGER,
  "actor_label" VARCHAR(160),
  "target_type" VARCHAR(40) NOT NULL,
  "target_id" VARCHAR(64),
  "definition_id" INTEGER,
  "instance_id" INTEGER,
  "summary" VARCHAR(500) NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "ip_address" VARCHAR(64),
  "user_agent" VARCHAR(300),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "prev_hash" CHAR(64),
  "entry_hash" CHAR(64) NOT NULL,
  CONSTRAINT "workflow_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_audit_log_store_id_seq_key"
  ON "workflow_audit_log"("store_id", "seq");
CREATE INDEX IF NOT EXISTS "workflow_audit_log_store_id_created_at_idx"
  ON "workflow_audit_log"("store_id", "created_at");
CREATE INDEX IF NOT EXISTS "workflow_audit_log_store_id_category_created_at_idx"
  ON "workflow_audit_log"("store_id", "category", "created_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_audit_log_store_id_fkey') THEN
    ALTER TABLE "workflow_audit_log" ADD CONSTRAINT "workflow_audit_log_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- Append-only: no UPDATE, DELETE or TRUNCATE, ever (same pattern as the P0/P4
-- evidence tables). The hash chain makes a bypass with the trigger disabled
-- detectable by "Verificar integridad".
CREATE OR REPLACE FUNCTION "workflow_audit_log_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY: % on workflow_audit_log is not allowed', TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workflow_audit_log_append_only_trg') THEN
    CREATE TRIGGER "workflow_audit_log_append_only_trg"
      BEFORE UPDATE OR DELETE ON "workflow_audit_log"
      FOR EACH ROW EXECUTE FUNCTION "workflow_audit_log_append_only"();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workflow_audit_log_no_truncate_trg') THEN
    CREATE TRIGGER "workflow_audit_log_no_truncate_trg"
      BEFORE TRUNCATE ON "workflow_audit_log"
      FOR EACH STATEMENT EXECUTE FUNCTION "workflow_audit_log_append_only"();
  END IF;
END $$;

-- ── P7.3 ────────────────────────────────────────────────────────────────────
ALTER TABLE "workflow_definitions" ADD COLUMN IF NOT EXISTS "access" JSONB;

-- ── P7.4 ────────────────────────────────────────────────────────────────────
ALTER TABLE "workflow_outbox" ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP(6);
CREATE INDEX IF NOT EXISTS "workflow_outbox_processed_at_idx"
  ON "workflow_outbox"("processed_at");

CREATE TABLE IF NOT EXISTS "workflow_ops_alerts" (
  "id" SERIAL NOT NULL,
  "rule" VARCHAR(40) NOT NULL,
  "severity" VARCHAR(16) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "store_id" INTEGER,
  "recipients" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_ops_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "workflow_ops_alerts_created_at_idx"
  ON "workflow_ops_alerts"("created_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_ops_alerts_store_id_fkey') THEN
    ALTER TABLE "workflow_ops_alerts" ADD CONSTRAINT "workflow_ops_alerts_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- ── P7.6 ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "workflow_exports" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "requested_by_user_id" INTEGER,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "s3_key" VARCHAR(500),
  "size_bytes" BIGINT,
  "file_count" INTEGER NOT NULL DEFAULT 0,
  "counts" JSONB NOT NULL DEFAULT '{}',
  "error" VARCHAR(500),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(6),
  "completed_at" TIMESTAMP(6),
  "expires_at" TIMESTAMP(6),
  CONSTRAINT "workflow_exports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "workflow_exports_store_id_created_at_idx"
  ON "workflow_exports"("store_id", "created_at");
CREATE INDEX IF NOT EXISTS "workflow_exports_status_created_at_idx"
  ON "workflow_exports"("status", "created_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_exports_store_id_fkey') THEN
    ALTER TABLE "workflow_exports" ADD CONSTRAINT "workflow_exports_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_exports_requested_by_user_id_fkey') THEN
    ALTER TABLE "workflow_exports" ADD CONSTRAINT "workflow_exports_requested_by_user_id_fkey"
      FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

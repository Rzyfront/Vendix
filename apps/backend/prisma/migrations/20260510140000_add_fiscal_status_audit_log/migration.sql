-- DATA IMPACT:
-- Tables affected: fiscal_status_audit_log (new table)
-- Expected row changes: 0 initial rows. Additive audit table only.
-- Destructive operations: none. No DROP, TRUNCATE, DELETE, or broad UPDATE.
-- FK/cascade risk: new FKs use RESTRICT for organization/store and SET NULL for changed_by_user_id.
-- Idempotency: guarded CREATE TYPE/TABLE/INDEX and guarded FK constraints.
-- Approval: fiscal_status implementation requested in chat.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_status_feature_enum') THEN
    CREATE TYPE "fiscal_status_feature_enum" AS ENUM ('invoicing', 'accounting', 'payroll');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_status_state_enum') THEN
    CREATE TYPE "fiscal_status_state_enum" AS ENUM ('INACTIVE', 'WIP', 'ACTIVE', 'LOCKED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_status_source_enum') THEN
    CREATE TYPE "fiscal_status_source_enum" AS ENUM ('manual', 'migration_v1', 'detector', 'event');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "fiscal_status_audit_log" (
  "id" SERIAL NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "feature" "fiscal_status_feature_enum" NOT NULL,
  "from_state" "fiscal_status_state_enum",
  "to_state" "fiscal_status_state_enum" NOT NULL,
  "source" "fiscal_status_source_enum" NOT NULL DEFAULT 'manual',
  "before_json" JSONB,
  "after_json" JSONB,
  "changed_by_user_id" INTEGER,
  "changed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_status_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fiscal_status_audit_log_organization_id_changed_at_idx"
  ON "fiscal_status_audit_log" ("organization_id", "changed_at" DESC);

CREATE INDEX IF NOT EXISTS "fiscal_status_audit_log_organization_feature_changed_at_idx"
  ON "fiscal_status_audit_log" ("organization_id", "feature", "changed_at" DESC);

CREATE INDEX IF NOT EXISTS "fiscal_status_audit_log_store_id_changed_at_idx"
  ON "fiscal_status_audit_log" ("store_id", "changed_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_status_audit_log_organization_id_fkey'
  ) THEN
    ALTER TABLE "fiscal_status_audit_log"
      ADD CONSTRAINT "fiscal_status_audit_log_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_status_audit_log_store_id_fkey'
  ) THEN
    ALTER TABLE "fiscal_status_audit_log"
      ADD CONSTRAINT "fiscal_status_audit_log_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_status_audit_log_changed_by_user_id_fkey'
  ) THEN
    ALTER TABLE "fiscal_status_audit_log"
      ADD CONSTRAINT "fiscal_status_audit_log_changed_by_user_id_fkey"
      FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

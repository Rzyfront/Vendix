-- DATA IMPACT:
-- Tables affected: organizations, accounting_entities, dian_configurations, fiscal_scope_audit_log
-- Expected row changes:
--   * Backfills organizations.fiscal_scope from organizations.operating_scope.
--   * Backfills accounting_entities.fiscal_scope from accounting_entities.scope.
--   * Best-effort links dian_configurations.accounting_entity_id to the current fiscal entity.
-- Destructive operations: none.
-- FK/cascade risk: adds SetNull FK from dian_configurations to accounting_entities; no cascaded deletes.
-- Idempotency: guarded CREATE TYPE/TABLE, ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, guarded constraints, WHERE-scoped updates.
-- Approval: fiscal-scope implementation approved in chat.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_scope_enum') THEN
    CREATE TYPE "fiscal_scope_enum" AS ENUM ('STORE', 'ORGANIZATION');
  END IF;
END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "fiscal_scope" "fiscal_scope_enum" NOT NULL DEFAULT 'STORE';

UPDATE "organizations"
SET "fiscal_scope" = "operating_scope"::text::"fiscal_scope_enum"
WHERE "fiscal_scope" IS DISTINCT FROM "operating_scope"::text::"fiscal_scope_enum";

CREATE INDEX IF NOT EXISTS "organizations_fiscal_scope_idx"
  ON "organizations" ("fiscal_scope");

CREATE TABLE IF NOT EXISTS "fiscal_scope_audit_log" (
  "id" SERIAL NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "previous_value" "fiscal_scope_enum" NOT NULL,
  "new_value" "fiscal_scope_enum" NOT NULL,
  "changed_by_user_id" INTEGER NOT NULL,
  "changed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" TEXT,
  "blocker_snapshot" JSONB,
  CONSTRAINT "fiscal_scope_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fiscal_scope_audit_log_organization_id_changed_at_idx"
  ON "fiscal_scope_audit_log" ("organization_id", "changed_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_scope_audit_log_organization_id_fkey'
  ) THEN
    ALTER TABLE "fiscal_scope_audit_log"
      ADD CONSTRAINT "fiscal_scope_audit_log_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_scope_audit_log_changed_by_user_id_fkey'
  ) THEN
    ALTER TABLE "fiscal_scope_audit_log"
      ADD CONSTRAINT "fiscal_scope_audit_log_changed_by_user_id_fkey"
      FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

ALTER TABLE "accounting_entities"
  ADD COLUMN IF NOT EXISTS "fiscal_scope" "fiscal_scope_enum" NOT NULL DEFAULT 'STORE';

UPDATE "accounting_entities"
SET "fiscal_scope" = "scope"::text::"fiscal_scope_enum"
WHERE "fiscal_scope" IS DISTINCT FROM "scope"::text::"fiscal_scope_enum";

CREATE INDEX IF NOT EXISTS "accounting_entities_organization_fiscal_scope_idx"
  ON "accounting_entities" ("organization_id", "fiscal_scope");

ALTER TABLE "dian_configurations"
  ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dian_configurations_accounting_entity_id_fkey'
  ) THEN
    ALTER TABLE "dian_configurations"
      ADD CONSTRAINT "dian_configurations_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "dian_configurations_accounting_entity_id_idx"
  ON "dian_configurations" ("accounting_entity_id");

UPDATE "dian_configurations" dc
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
JOIN "accounting_entities" ae ON ae."organization_id" = o."id"
WHERE dc."organization_id" = o."id"
  AND dc."accounting_entity_id" IS NULL
  AND ae."is_active" = TRUE
  AND (
   (
     o."fiscal_scope" = 'ORGANIZATION'::"fiscal_scope_enum"
     AND ae."scope" = 'ORGANIZATION'::"organization_operating_scope_enum"
     AND ae."fiscal_scope" = 'ORGANIZATION'::"fiscal_scope_enum"
     AND ae."store_id" IS NULL
   )
   OR
   (
     o."fiscal_scope" = 'STORE'::"fiscal_scope_enum"
     AND ae."scope" = 'STORE'::"organization_operating_scope_enum"
     AND ae."fiscal_scope" = 'STORE'::"fiscal_scope_enum"
     AND ae."store_id" = dc."store_id"
   )
  );

ALTER TABLE "intercompany_transactions"
  ALTER COLUMN "session_id" DROP NOT NULL;

ALTER TABLE "intercompany_transactions"
  ADD COLUMN IF NOT EXISTS "origin" VARCHAR(50) NOT NULL DEFAULT 'consolidation',
  ADD COLUMN IF NOT EXISTS "source_type" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "source_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "status" VARCHAR(30) NOT NULL DEFAULT 'open';

CREATE INDEX IF NOT EXISTS "intercompany_transactions_organization_source_idx"
  ON "intercompany_transactions" ("organization_id", "source_type", "source_id");

CREATE INDEX IF NOT EXISTS "intercompany_transactions_organization_status_idx"
  ON "intercompany_transactions" ("organization_id", "status");

-- DATA IMPACT:
-- Tables affected: stores, invoice_resolutions, payroll_runs, payroll_items,
-- payroll_settlements, uvt_values, withholding_concepts, withholding_calculations.
-- Expected row changes: best-effort backfill of new accounting_entity_id columns
-- from existing accounting_entities using each row's persisted fiscal anchor
-- (store_id when present, otherwise consolidated org entity when deterministic).
-- Destructive operations: none. No DELETE, TRUNCATE, DROP TABLE, or column drops.
-- FK/cascade risk: new FKs point to accounting_entities(id) with ON DELETE SET NULL.
-- Idempotency: guarded by IF EXISTS / IF NOT EXISTS and WHERE ... IS NULL checks.
-- Approval: requested by user in fiscal_scope gap-closure execution.

BEGIN;

-- Store-level legal identity. Do not copy organization NIT values into stores:
-- each store must own its fiscal identity when fiscal_scope=STORE.
ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "legal_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "tax_id" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "tax_id_dv" VARCHAR(2),
  ADD COLUMN IF NOT EXISTS "nit_type" "dian_nit_type_enum";

CREATE INDEX IF NOT EXISTS "stores_organization_tax_id_idx"
  ON "stores" ("organization_id", "tax_id");

-- Backfill only from store-owned settings when present. This preserves the
-- non-destructive rule by avoiding organization-level fallback.
UPDATE "stores" s
SET
  "legal_name" = COALESCE(s."legal_name", NULLIF(ss."settings" #>> '{fiscal_data,legal_name}', '')),
  "tax_id" = COALESCE(s."tax_id", NULLIF(ss."settings" #>> '{fiscal_data,nit}', '')),
  "tax_id_dv" = COALESCE(s."tax_id_dv", NULLIF(ss."settings" #>> '{fiscal_data,nit_dv}', ''))
FROM "store_settings" ss
WHERE ss."store_id" = s."id"
  AND (
    s."legal_name" IS NULL
    OR s."tax_id" IS NULL
    OR s."tax_id_dv" IS NULL
  );

-- New fiscal entity anchors.
ALTER TABLE "invoice_resolutions"
  ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;

ALTER TABLE "payroll_runs"
  ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;

ALTER TABLE "payroll_items"
  ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;

ALTER TABLE "payroll_settlements"
  ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;

ALTER TABLE "uvt_values"
  ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;

ALTER TABLE "withholding_concepts"
  ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;

ALTER TABLE "withholding_calculations"
  ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;

-- Organization-scoped invoice resolutions require store_id=NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_resolutions'
      AND column_name = 'store_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "invoice_resolutions"
      ALTER COLUMN "store_id" DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_resolutions_accounting_entity_id_fkey'
  ) THEN
    ALTER TABLE "invoice_resolutions"
      ADD CONSTRAINT "invoice_resolutions_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_runs_accounting_entity_id_fkey'
  ) THEN
    ALTER TABLE "payroll_runs"
      ADD CONSTRAINT "payroll_runs_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_items_accounting_entity_id_fkey'
  ) THEN
    ALTER TABLE "payroll_items"
      ADD CONSTRAINT "payroll_items_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_settlements_accounting_entity_id_fkey'
  ) THEN
    ALTER TABLE "payroll_settlements"
      ADD CONSTRAINT "payroll_settlements_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uvt_values_accounting_entity_id_fkey'
  ) THEN
    ALTER TABLE "uvt_values"
      ADD CONSTRAINT "uvt_values_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'withholding_concepts_accounting_entity_id_fkey'
  ) THEN
    ALTER TABLE "withholding_concepts"
      ADD CONSTRAINT "withholding_concepts_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'withholding_calculations_accounting_entity_id_fkey'
  ) THEN
    ALTER TABLE "withholding_calculations"
      ADD CONSTRAINT "withholding_calculations_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "invoice_resolutions_accounting_entity_id_idx"
  ON "invoice_resolutions" ("accounting_entity_id");
CREATE INDEX IF NOT EXISTS "invoice_resolutions_entity_active_idx"
  ON "invoice_resolutions" ("accounting_entity_id", "is_active");
CREATE INDEX IF NOT EXISTS "invoice_resolutions_org_entity_idx"
  ON "invoice_resolutions" ("organization_id", "accounting_entity_id");

CREATE INDEX IF NOT EXISTS "payroll_runs_accounting_entity_id_idx"
  ON "payroll_runs" ("accounting_entity_id");
CREATE INDEX IF NOT EXISTS "payroll_items_accounting_entity_id_idx"
  ON "payroll_items" ("accounting_entity_id");
CREATE INDEX IF NOT EXISTS "payroll_settlements_accounting_entity_id_idx"
  ON "payroll_settlements" ("accounting_entity_id");
CREATE INDEX IF NOT EXISTS "uvt_values_accounting_entity_id_idx"
  ON "uvt_values" ("accounting_entity_id");
CREATE INDEX IF NOT EXISTS "withholding_concepts_accounting_entity_id_idx"
  ON "withholding_concepts" ("accounting_entity_id");
CREATE INDEX IF NOT EXISTS "withholding_calculations_accounting_entity_id_idx"
  ON "withholding_calculations" ("accounting_entity_id");

-- Replace org-wide uniques with fiscal-entity-aware uniqueness.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_resolutions_organization_id_store_id_prefix_key'
  ) THEN
    ALTER TABLE "invoice_resolutions"
      DROP CONSTRAINT "invoice_resolutions_organization_id_store_id_prefix_key";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uvt_values_organization_id_year_key'
  ) THEN
    ALTER TABLE "uvt_values"
      DROP CONSTRAINT "uvt_values_organization_id_year_key";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'withholding_concepts_organization_id_code_key'
  ) THEN
    ALTER TABLE "withholding_concepts"
      DROP CONSTRAINT "withholding_concepts_organization_id_code_key";
  END IF;
END $$;

DROP INDEX IF EXISTS "invoice_resolutions_organization_id_store_id_prefix_key";
DROP INDEX IF EXISTS "uvt_values_organization_id_year_key";
DROP INDEX IF EXISTS "withholding_concepts_organization_id_code_key";

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_resolutions_entity_prefix_uidx"
  ON "invoice_resolutions" ("accounting_entity_id", "prefix")
  WHERE "accounting_entity_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_resolutions_store_prefix_no_entity_uidx"
  ON "invoice_resolutions" ("organization_id", "store_id", "prefix")
  WHERE "accounting_entity_id" IS NULL AND "store_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_resolutions_org_prefix_no_store_no_entity_uidx"
  ON "invoice_resolutions" ("organization_id", "prefix")
  WHERE "accounting_entity_id" IS NULL AND "store_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uvt_values_organization_id_accounting_entity_id_year_key"
  ON "uvt_values" ("organization_id", "accounting_entity_id", "year");

CREATE UNIQUE INDEX IF NOT EXISTS "uvt_values_org_year_no_entity_uidx"
  ON "uvt_values" ("organization_id", "year")
  WHERE "accounting_entity_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "withholding_concepts_organization_id_accounting_entity_id_code_key"
  ON "withholding_concepts" ("organization_id", "accounting_entity_id", "code");

CREATE UNIQUE INDEX IF NOT EXISTS "withholding_concepts_org_code_no_entity_uidx"
  ON "withholding_concepts" ("organization_id", "code")
  WHERE "accounting_entity_id" IS NULL;

-- Backfill rows with a persisted store anchor to the store fiscal entity.
UPDATE "invoice_resolutions" ir
SET "accounting_entity_id" = ae."id"
FROM "accounting_entities" ae
WHERE ir."accounting_entity_id" IS NULL
  AND ir."store_id" IS NOT NULL
  AND ae."organization_id" = ir."organization_id"
  AND ae."store_id" = ir."store_id"
  AND ae."scope" = 'STORE'::"organization_operating_scope_enum"
  AND ae."fiscal_scope" = 'STORE'::"fiscal_scope_enum"
  AND ae."is_active" = TRUE;

UPDATE "invoice_resolutions" ir
SET "accounting_entity_id" = ae."id"
FROM "accounting_entities" ae
WHERE ir."accounting_entity_id" IS NULL
  AND ir."store_id" IS NULL
  AND ae."organization_id" = ir."organization_id"
  AND ae."store_id" IS NULL
  AND ae."scope" = 'ORGANIZATION'::"organization_operating_scope_enum"
  AND ae."fiscal_scope" = 'ORGANIZATION'::"fiscal_scope_enum"
  AND ae."is_active" = TRUE;

UPDATE "payroll_runs" pr
SET "accounting_entity_id" = ae."id"
FROM "accounting_entities" ae
WHERE pr."accounting_entity_id" IS NULL
  AND (
    (
      pr."store_id" IS NOT NULL
      AND ae."organization_id" = pr."organization_id"
      AND ae."store_id" = pr."store_id"
      AND ae."scope" = 'STORE'::"organization_operating_scope_enum"
      AND ae."fiscal_scope" = 'STORE'::"fiscal_scope_enum"
    )
    OR
    (
      pr."store_id" IS NULL
      AND ae."organization_id" = pr."organization_id"
      AND ae."store_id" IS NULL
      AND ae."scope" = 'ORGANIZATION'::"organization_operating_scope_enum"
      AND ae."fiscal_scope" = 'ORGANIZATION'::"fiscal_scope_enum"
    )
  )
  AND ae."is_active" = TRUE;

UPDATE "payroll_items" pi
SET "accounting_entity_id" = pr."accounting_entity_id"
FROM "payroll_runs" pr
WHERE pi."accounting_entity_id" IS NULL
  AND pi."payroll_run_id" = pr."id"
  AND pr."accounting_entity_id" IS NOT NULL;

UPDATE "payroll_settlements" ps
SET "accounting_entity_id" = ae."id"
FROM "accounting_entities" ae
WHERE ps."accounting_entity_id" IS NULL
  AND (
    (
      ps."store_id" IS NOT NULL
      AND ae."organization_id" = ps."organization_id"
      AND ae."store_id" = ps."store_id"
      AND ae."scope" = 'STORE'::"organization_operating_scope_enum"
      AND ae."fiscal_scope" = 'STORE'::"fiscal_scope_enum"
    )
    OR
    (
      ps."store_id" IS NULL
      AND ae."organization_id" = ps."organization_id"
      AND ae."store_id" IS NULL
      AND ae."scope" = 'ORGANIZATION'::"organization_operating_scope_enum"
      AND ae."fiscal_scope" = 'ORGANIZATION'::"fiscal_scope_enum"
    )
  )
  AND ae."is_active" = TRUE;

-- Concepts and UVT values historically had no store anchor. Backfill only when
-- there is a deterministic current fiscal entity; unresolved legacy rows remain
-- visible through fiscal-aware OR scoping as accounting_entity_id IS NULL.
WITH single_store_orgs AS (
  SELECT "organization_id", MIN("id") AS "store_id"
  FROM "stores"
  WHERE "is_active" = TRUE
  GROUP BY "organization_id"
  HAVING COUNT(*) = 1
)
UPDATE "uvt_values" uv
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
LEFT JOIN single_store_orgs sso ON sso."organization_id" = o."id"
JOIN "accounting_entities" ae ON ae."organization_id" = o."id"
WHERE uv."organization_id" = o."id"
  AND uv."accounting_entity_id" IS NULL
  AND ae."is_active" = TRUE
  AND (
    (
      o."fiscal_scope" = 'ORGANIZATION'::"fiscal_scope_enum"
      AND ae."store_id" IS NULL
      AND ae."scope" = 'ORGANIZATION'::"organization_operating_scope_enum"
      AND ae."fiscal_scope" = 'ORGANIZATION'::"fiscal_scope_enum"
    )
    OR
    (
      o."fiscal_scope" = 'STORE'::"fiscal_scope_enum"
      AND ae."store_id" = sso."store_id"
      AND ae."scope" = 'STORE'::"organization_operating_scope_enum"
      AND ae."fiscal_scope" = 'STORE'::"fiscal_scope_enum"
    )
  );

WITH single_store_orgs AS (
  SELECT "organization_id", MIN("id") AS "store_id"
  FROM "stores"
  WHERE "is_active" = TRUE
  GROUP BY "organization_id"
  HAVING COUNT(*) = 1
)
UPDATE "withholding_concepts" wc
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
LEFT JOIN single_store_orgs sso ON sso."organization_id" = o."id"
JOIN "accounting_entities" ae ON ae."organization_id" = o."id"
WHERE wc."organization_id" = o."id"
  AND wc."accounting_entity_id" IS NULL
  AND ae."is_active" = TRUE
  AND (
    (
      o."fiscal_scope" = 'ORGANIZATION'::"fiscal_scope_enum"
      AND ae."store_id" IS NULL
      AND ae."scope" = 'ORGANIZATION'::"organization_operating_scope_enum"
      AND ae."fiscal_scope" = 'ORGANIZATION'::"fiscal_scope_enum"
    )
    OR
    (
      o."fiscal_scope" = 'STORE'::"fiscal_scope_enum"
      AND ae."store_id" = sso."store_id"
      AND ae."scope" = 'STORE'::"organization_operating_scope_enum"
      AND ae."fiscal_scope" = 'STORE'::"fiscal_scope_enum"
    )
  );

UPDATE "withholding_calculations" wc
SET "accounting_entity_id" = ae."id"
FROM "accounting_entities" ae
WHERE wc."accounting_entity_id" IS NULL
  AND (
    (
      wc."store_id" IS NOT NULL
      AND ae."organization_id" = wc."organization_id"
      AND ae."store_id" = wc."store_id"
      AND ae."scope" = 'STORE'::"organization_operating_scope_enum"
      AND ae."fiscal_scope" = 'STORE'::"fiscal_scope_enum"
    )
    OR
    (
      wc."store_id" IS NULL
      AND ae."organization_id" = wc."organization_id"
      AND ae."store_id" IS NULL
      AND ae."scope" = 'ORGANIZATION'::"organization_operating_scope_enum"
      AND ae."fiscal_scope" = 'ORGANIZATION'::"fiscal_scope_enum"
    )
  )
  AND ae."is_active" = TRUE;

COMMIT;

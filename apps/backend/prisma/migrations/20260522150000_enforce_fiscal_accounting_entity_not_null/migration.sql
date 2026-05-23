-- DATA IMPACT:
-- Tables affected: invoices, invoice_resolutions, dian_configurations, payroll_runs, payroll_items, fiscal_evidences
-- Expected row changes: backfills accounting_entity_id from organizations.fiscal_scope and existing active accounting_entities.
-- Destructive operations: none.
-- FK/cascade risk: strengthens fiscal-document ownership by making accounting_entity_id NOT NULL on DIAN/fiscal documents.
-- Idempotency: guarded indexes and null-only updates; preflight checks fail if fiscal ownership is ambiguous.
-- Approval: DIAN own-software execution plan requested by the user.

UPDATE "invoices" i
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
JOIN "accounting_entities" ae
  ON ae."organization_id" = o."id"
WHERE i."accounting_entity_id" IS NULL
  AND o."id" = i."organization_id"
  AND ae."is_active" = TRUE
  AND (
    (
      o."fiscal_scope" = 'ORGANIZATION'
      AND ae."store_id" IS NULL
      AND ae."scope" = 'ORGANIZATION'
      AND ae."fiscal_scope" = 'ORGANIZATION'
    )
    OR (
      o."fiscal_scope" = 'STORE'
      AND ae."store_id" = i."store_id"
      AND ae."scope" = 'STORE'
      AND ae."fiscal_scope" = 'STORE'
    )
  );

UPDATE "invoice_resolutions" r
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
JOIN "accounting_entities" ae
  ON ae."organization_id" = o."id"
WHERE r."accounting_entity_id" IS NULL
  AND o."id" = r."organization_id"
  AND ae."is_active" = TRUE
  AND (
    (
      o."fiscal_scope" = 'ORGANIZATION'
      AND ae."store_id" IS NULL
      AND ae."scope" = 'ORGANIZATION'
      AND ae."fiscal_scope" = 'ORGANIZATION'
    )
    OR (
      o."fiscal_scope" = 'STORE'
      AND ae."store_id" = r."store_id"
      AND ae."scope" = 'STORE'
      AND ae."fiscal_scope" = 'STORE'
    )
  );

UPDATE "dian_configurations" dc
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
JOIN "accounting_entities" ae
  ON ae."organization_id" = o."id"
WHERE dc."accounting_entity_id" IS NULL
  AND o."id" = dc."organization_id"
  AND ae."is_active" = TRUE
  AND (
    (
      o."fiscal_scope" = 'ORGANIZATION'
      AND ae."store_id" IS NULL
      AND ae."scope" = 'ORGANIZATION'
      AND ae."fiscal_scope" = 'ORGANIZATION'
    )
    OR (
      o."fiscal_scope" = 'STORE'
      AND ae."store_id" = dc."store_id"
      AND ae."scope" = 'STORE'
      AND ae."fiscal_scope" = 'STORE'
    )
  );

UPDATE "payroll_runs" pr
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
JOIN "accounting_entities" ae
  ON ae."organization_id" = o."id"
WHERE pr."accounting_entity_id" IS NULL
  AND o."id" = pr."organization_id"
  AND ae."is_active" = TRUE
  AND (
    (
      o."fiscal_scope" = 'ORGANIZATION'
      AND ae."store_id" IS NULL
      AND ae."scope" = 'ORGANIZATION'
      AND ae."fiscal_scope" = 'ORGANIZATION'
    )
    OR (
      o."fiscal_scope" = 'STORE'
      AND ae."store_id" = pr."store_id"
      AND ae."scope" = 'STORE'
      AND ae."fiscal_scope" = 'STORE'
    )
  );

UPDATE "payroll_items" pi
SET "accounting_entity_id" = pr."accounting_entity_id"
FROM "payroll_runs" pr
WHERE pi."accounting_entity_id" IS NULL
  AND pr."id" = pi."payroll_run_id"
  AND pr."accounting_entity_id" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "invoices" WHERE "accounting_entity_id" IS NULL) THEN
    RAISE EXCEPTION 'DIAN migration blocked: invoices without accounting_entity_id remain after fiscal-scope backfill';
  END IF;

  IF EXISTS (SELECT 1 FROM "invoice_resolutions" WHERE "accounting_entity_id" IS NULL) THEN
    RAISE EXCEPTION 'DIAN migration blocked: invoice_resolutions without accounting_entity_id remain after fiscal-scope backfill';
  END IF;

  IF EXISTS (SELECT 1 FROM "dian_configurations" WHERE "accounting_entity_id" IS NULL) THEN
    RAISE EXCEPTION 'DIAN migration blocked: dian_configurations without accounting_entity_id remain after fiscal-scope backfill';
  END IF;

  IF EXISTS (SELECT 1 FROM "payroll_runs" WHERE "accounting_entity_id" IS NULL) THEN
    RAISE EXCEPTION 'DIAN migration blocked: payroll_runs without accounting_entity_id remain after fiscal-scope backfill';
  END IF;

  IF EXISTS (SELECT 1 FROM "payroll_items" WHERE "accounting_entity_id" IS NULL) THEN
    RAISE EXCEPTION 'DIAN migration blocked: payroll_items without accounting_entity_id remain after fiscal-scope backfill';
  END IF;
END $$;

ALTER TABLE "invoices"
  ALTER COLUMN "accounting_entity_id" SET NOT NULL;

ALTER TABLE "invoice_resolutions"
  ALTER COLUMN "accounting_entity_id" SET NOT NULL;

ALTER TABLE "dian_configurations"
  ALTER COLUMN "accounting_entity_id" SET NOT NULL;

ALTER TABLE "payroll_runs"
  ALTER COLUMN "accounting_entity_id" SET NOT NULL;

ALTER TABLE "payroll_items"
  ALTER COLUMN "accounting_entity_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_evidences_transmission_type_hash_key"
  ON "fiscal_evidences" ("fiscal_transmission_id", "evidence_type", "content_hash");

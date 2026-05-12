-- DATA IMPACT:
-- Tables affected: organizations, accounting_entities
-- Expected row changes: none. This migration only validates existing rows and changes constraints/indexes.
-- Destructive operations: drops the old accounting_entities unique constraint after preflight validation.
-- FK/cascade risk: none.
-- Idempotency: guarded by pg_constraint/pg_indexes checks and preflight DO blocks.
-- Approval: requested by user in fiscal_scope gap-closure execution.

DO $$
DECLARE
  invalid_count integer;
BEGIN
  SELECT COUNT(*)
    INTO invalid_count
    FROM "organizations"
   WHERE "operating_scope" = 'STORE'
     AND "fiscal_scope" = 'ORGANIZATION';

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add organizations valid-scope check: % organization(s) have operating_scope=STORE and fiscal_scope=ORGANIZATION',
      invalid_count;
  END IF;
END $$;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*)
    INTO duplicate_count
    FROM (
      SELECT "organization_id", "store_id", "scope", "fiscal_scope"
        FROM "accounting_entities"
       WHERE "store_id" IS NOT NULL
       GROUP BY "organization_id", "store_id", "scope", "fiscal_scope"
      HAVING COUNT(*) > 1
    ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add fiscal-aware accounting_entities unique constraint: % duplicate non-null store group(s) exist',
      duplicate_count;
  END IF;
END $$;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*)
    INTO duplicate_count
    FROM (
      SELECT "organization_id", "scope", "fiscal_scope"
        FROM "accounting_entities"
       WHERE "store_id" IS NULL
         AND "is_active" = true
       GROUP BY "organization_id", "scope", "fiscal_scope"
      HAVING COUNT(*) > 1
    ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add fiscal-aware accounting_entities null-store unique index: % active consolidated duplicate group(s) exist',
      duplicate_count;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'accounting_entities_organization_store_scope_key'
  ) THEN
    ALTER TABLE "accounting_entities"
      DROP CONSTRAINT "accounting_entities_organization_store_scope_key";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'accounting_entities_org_store_scope_fiscal_scope_key'
  ) THEN
    ALTER TABLE "accounting_entities"
      ADD CONSTRAINT "accounting_entities_org_store_scope_fiscal_scope_key"
      UNIQUE ("organization_id", "store_id", "scope", "fiscal_scope");
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "accounting_entities_org_null_store_scope_fiscal_active_key"
  ON "accounting_entities" ("organization_id", "scope", "fiscal_scope")
  WHERE "store_id" IS NULL AND "is_active" = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'organizations_valid_fiscal_operating_scope_chk'
  ) THEN
    ALTER TABLE "organizations"
      ADD CONSTRAINT "organizations_valid_fiscal_operating_scope_chk"
      CHECK (NOT ("operating_scope" = 'STORE' AND "fiscal_scope" = 'ORGANIZATION'));
  END IF;
END $$;

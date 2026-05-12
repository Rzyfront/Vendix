-- DATA IMPACT:
-- Tables affected: dian_configurations (schema only)
-- Expected row changes: none — existing rows all have store_id NOT NULL and
--                      organization_id NOT NULL; relaxing NOT NULL on store_id
--                      does not modify any data. CHECK constraint and partial
--                      unique indexes are satisfied at apply time.
-- Destructive operations: drops unique constraint
--                         dian_configurations_store_id_nit_key, immediately
--                         replaced by two partial unique indexes that cover the
--                         same key space (store-scope) plus a new org-scope
--                         partial unique index for ORGANIZATION fiscal scope.
-- FK/cascade risk: existing FK store_id -> stores(id) is preserved with its
--                  current ON DELETE CASCADE; only the column nullability
--                  changes. organization_id -> organizations(id) remains
--                  NOT NULL with ON DELETE CASCADE.
-- Idempotency: guarded by IF NOT EXISTS / IF EXISTS / pg_constraint lookups.
-- Reversibility: reapplying NOT NULL on store_id requires purging rows where
--                store_id IS NULL (org-scoped DIAN configs). Dropping the
--                check/indexes is straightforward via standard SQL.

BEGIN;

-- 1. Relax NOT NULL on store_id so ORGANIZATION-scoped DIAN configs can be
--    anchored to the organization only (store_id IS NULL).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dian_configurations'
      AND column_name = 'store_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "dian_configurations"
      ALTER COLUMN "store_id" DROP NOT NULL;
  END IF;
END $$;

-- 2. Drop the legacy unique (store_id, nit). It cannot cover org-scoped rows
--    where store_id IS NULL, and would also block multiple org-scoped rows for
--    the same nit across different environments. We replace it with partial
--    unique indexes that differentiate STORE-scope vs ORG-scope explicitly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dian_configurations_store_id_nit_key'
      AND conrelid = '"dian_configurations"'::regclass
  ) THEN
    ALTER TABLE "dian_configurations"
      DROP CONSTRAINT "dian_configurations_store_id_nit_key";
  END IF;
END $$;

-- Postgres may keep the backing index of the unique constraint under the same
-- name; drop it idempotently in case the constraint was already removed.
DROP INDEX IF EXISTS "dian_configurations_store_id_nit_key";

-- 3. Partial unique indexes enforcing scope-specific uniqueness.
--    Store-scoped rows: unique by (store_id, nit) when store_id IS NOT NULL.
--    Existing rows all satisfy this index, so it can be created without
--    backfill.
CREATE UNIQUE INDEX IF NOT EXISTS "dian_configurations_store_scope_uq"
  ON "dian_configurations" ("store_id", "nit")
  WHERE "store_id" IS NOT NULL;

--    Org-scoped rows: unique by (organization_id, nit) when store_id IS NULL.
--    No existing rows match this predicate today; index starts empty.
CREATE UNIQUE INDEX IF NOT EXISTS "dian_configurations_org_scope_uq"
  ON "dian_configurations" ("organization_id", "nit")
  WHERE "store_id" IS NULL;

-- 4. CHECK constraint: organization_id is always required. store_id is
--    now optional — its presence is governed by organizations.fiscal_scope
--    (STORE => NOT NULL, ORGANIZATION => NULL). The DB constraint enforces
--    the invariant that every DIAN config is anchored to an org.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dian_configurations_scope_org_chk'
      AND conrelid = '"dian_configurations"'::regclass
  ) THEN
    ALTER TABLE "dian_configurations"
      ADD CONSTRAINT "dian_configurations_scope_org_chk"
      CHECK ("organization_id" IS NOT NULL);
  END IF;
END $$;

COMMIT;

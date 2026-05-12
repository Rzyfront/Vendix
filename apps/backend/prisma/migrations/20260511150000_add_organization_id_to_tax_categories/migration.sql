-- DATA IMPACT:
-- Tables affected: tax_categories (schema only)
-- Expected row changes: none — existing rows all have store_id set; CHECK constraint
--                      is satisfied at apply time because (store_id IS NOT NULL) XOR
--                      (organization_id IS NULL) is true for every existing row.
-- Destructive operations: drops unique constraint tax_categories_store_id_name_key,
--                         immediately replaced by two partial unique indexes covering
--                         the same key space.
-- FK/cascade risk: new FK to organizations(id) uses ON DELETE RESTRICT.
-- Idempotency: guarded by IF NOT EXISTS / IF EXISTS / pg_constraint lookups.

-- 1. Add organization_id column (nullable, FK to organizations) idempotently.
ALTER TABLE "tax_categories"
  ADD COLUMN IF NOT EXISTS "organization_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tax_categories_organization_id_fkey'
      AND conrelid = '"tax_categories"'::regclass
  ) THEN
    ALTER TABLE "tax_categories"
      ADD CONSTRAINT "tax_categories_organization_id_fkey"
      FOREIGN KEY ("organization_id")
      REFERENCES "organizations"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tax_categories_organization_id_idx"
  ON "tax_categories"("organization_id");

-- 2. Drop legacy unique (store_id, name) which doesn't support org-scoped rows.
--    Replaced below by two partial unique indexes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tax_categories_store_id_name_key'
      AND conrelid = '"tax_categories"'::regclass
  ) THEN
    ALTER TABLE "tax_categories"
      DROP CONSTRAINT "tax_categories_store_id_name_key";
  END IF;
END $$;

-- Postgres may also expose the unique as an index of the same name; drop if leftover.
DROP INDEX IF EXISTS "tax_categories_store_id_name_key";

-- 3. Partial unique indexes enforcing one-of (store, org) scope uniqueness.
--    Store-scoped rows: unique by (store_id, name) when organization_id IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "tax_categories_store_name"
  ON "tax_categories"("store_id", "name")
  WHERE "organization_id" IS NULL;

--    Org-scoped rows: unique by (organization_id, name) when store_id IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "tax_categories_org_name"
  ON "tax_categories"("organization_id", "name")
  WHERE "store_id" IS NULL;

-- 4. CHECK constraint: exactly one of store_id / organization_id must be set.
--    Existing rows all have store_id NOT NULL and organization_id NULL, so they
--    satisfy the constraint without backfill.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tax_categories_scope_chk'
      AND conrelid = '"tax_categories"'::regclass
  ) THEN
    ALTER TABLE "tax_categories"
      ADD CONSTRAINT "tax_categories_scope_chk"
      CHECK (("store_id" IS NULL) <> ("organization_id" IS NULL));
  END IF;
END $$;

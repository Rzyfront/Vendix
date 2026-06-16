-- =====================================================================
-- UoM exact control for restaurant ingredients (Fase UoM)
-- =====================================================================
-- DATA IMPACT:
-- Tables affected:
--   - units_of_measure         (NEW global catalog, seeded below)
--   - products                 (additive: stock_uom_id, purchase_uom_id FKs)
--   - recipe_items             (additive: waste_mode, waste_absolute)
--   - 2 NEW enums: uom_dimension_enum, waste_mode_enum
-- Expected row changes: 0 destructive mutations.
--   - All ALTER TABLE ADD COLUMN are nullable / have server-side defaults so
--     existing rows backfill atomically.
--   - 6 rows inserted into units_of_measure (g, mg, kg, ml, L, unit) with
--     ON CONFLICT DO NOTHING to make this migration re-runnable.
-- Destructive operations: none.
-- FK/cascade risk: minimal.
--   - New FKs use ON DELETE SET NULL (catalog rows may be removed in the
--     future without orphaning products).
-- Idempotency:
--   - Enum and table creation guarded by DO $$ blocks and IF NOT EXISTS.
--   - Column additions use IF NOT EXISTS via pg_attribute preflight.
--   - Index creation uses IF NOT EXISTS.
--   - UoM catalog seed uses ON CONFLICT (code) DO NOTHING.
-- Approval: documented in plan at ~/.claude/plans/actualmente-tenemos-un-sistema-tingly-mist.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Enums (idempotent)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'uom_dimension_enum') THEN
    CREATE TYPE "uom_dimension_enum" AS ENUM ('mass', 'volume', 'count');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'waste_mode_enum') THEN
    CREATE TYPE "waste_mode_enum" AS ENUM ('percent', 'absolute');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2) Table units_of_measure (global, read-only catalog)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "units_of_measure" (
  "id"             SERIAL PRIMARY KEY,
  "code"           VARCHAR(20) NOT NULL,
  "name"           VARCHAR(60) NOT NULL,
  "dimension"      "uom_dimension_enum" NOT NULL,
  "is_base"        BOOLEAN NOT NULL DEFAULT false,
  "factor_to_base" DECIMAL(18, 6) NOT NULL,
  "is_active"      BOOLEAN NOT NULL DEFAULT true,
  "created_at"     TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "units_of_measure_code_key" ON "units_of_measure"("code");
CREATE INDEX IF NOT EXISTS "units_of_measure_dimension_idx" ON "units_of_measure"("dimension");
CREATE INDEX IF NOT EXISTS "units_of_measure_is_active_idx" ON "units_of_measure"("is_active");

-- ---------------------------------------------------------------------
-- 3) Seed the UoM catalog (6 base units). Re-runnable.
-- ---------------------------------------------------------------------
INSERT INTO "units_of_measure" ("code", "name", "dimension", "is_base", "factor_to_base") VALUES
  ('g',     'Gramo',     'mass',   true,  1.000000),
  ('mg',    'Miligramo', 'mass',   false, 0.001000),
  ('kg',    'Kilogramo', 'mass',   false, 1000.000000),
  ('ml',    'Mililitro', 'volume', true,  1.000000),
  ('L',     'Litro',     'volume', false, 1000.000000),
  ('unit',  'Unidad',    'count',  true,  1.000000)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------
-- 4) products — additive FKs to units_of_measure
-- ---------------------------------------------------------------------
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "stock_uom_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "purchase_uom_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_uom_id_fkey'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_stock_uom_id_fkey"
      FOREIGN KEY ("stock_uom_id") REFERENCES "units_of_measure"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_purchase_uom_id_fkey'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_purchase_uom_id_fkey"
      FOREIGN KEY ("purchase_uom_id") REFERENCES "units_of_measure"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "products_stock_uom_id_idx"    ON "products"("stock_uom_id");
CREATE INDEX IF NOT EXISTS "products_purchase_uom_id_idx" ON "products"("purchase_uom_id");
-- The is_ingredient index was already added by the restaurant_suite_foundation
-- migration; this is a no-op guard for environments that applied an older
-- version of that migration.
CREATE INDEX IF NOT EXISTS "products_store_id_is_ingredient_idx"
  ON "products"("store_id", "is_ingredient");

-- ---------------------------------------------------------------------
-- 5) recipe_items — additive waste_mode + waste_absolute
-- ---------------------------------------------------------------------
ALTER TABLE "recipe_items"
  ADD COLUMN IF NOT EXISTS "waste_mode" "waste_mode_enum" NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS "waste_absolute" DECIMAL(12, 4) NOT NULL DEFAULT 0;

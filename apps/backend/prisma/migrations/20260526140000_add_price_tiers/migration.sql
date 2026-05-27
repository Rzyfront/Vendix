-- DATA IMPACT:
--   Tables affected:
--     - price_tiers                       (CREATE TABLE IF NOT EXISTS, no rows touched)
--     - product_price_tier_overrides      (CREATE TABLE IF NOT EXISTS, no rows touched)
--     - products                          (ADD nullable/defaulted columns: has_multiple_price_tiers,
--                                          units_per_package, package_consumes_multiple_stock)
--     - order_items                       (ADD nullable columns: applied_price_tier_id,
--                                          applied_price_tier_name_snapshot, stock_units_consumed)
--     - quotation_items                   (ADD nullable columns: applied_price_tier_id,
--                                          applied_price_tier_name_snapshot, stock_units_consumed)
--   Expected row changes:
--     - No UPDATE/DELETE of existing rows. Existing products keep
--       has_multiple_price_tiers = FALSE (default), so legacy behavior is preserved.
--     - Existing order_items / quotation_items keep applied_price_tier_id = NULL
--       and applied_price_tier_name_snapshot = NULL.
--   Destructive operations: none (no DROP, no TRUNCATE, no CASCADE, no unscoped DELETE/UPDATE).
--   FK/cascade risk:
--     - order_items.applied_price_tier_id FK uses ON DELETE SET NULL so deleting a
--       price tier never destroys historical line items; the
--       applied_price_tier_name_snapshot column preserves the human label.
--     - quotation_items.applied_price_tier_id FK uses ON DELETE SET NULL for the
--       same audit-preservation reason.
--     - product_price_tier_overrides FKs use ON DELETE CASCADE because these rows
--       are pure denormalized overrides — when the parent product/variant/tier is
--       deleted (super-admin action only), the override row has no meaning.
--   Idempotency: guarded with IF NOT EXISTS, DO $$ ... EXCEPTION blocks and
--     pg_constraint pre-checks; safe to re-run.
--   Approval: Phase 1 of approved plan
--     plans/quiero-que-hagas-un-polished-sparrow.md (multi-price tier system).

BEGIN;

-- 1. price_tiers table
CREATE TABLE IF NOT EXISTS "price_tiers" (
  "id"                  SERIAL          PRIMARY KEY,
  "store_id"            INTEGER         NOT NULL,
  "name"                VARCHAR(255)    NOT NULL,
  "code"                VARCHAR(50),
  "description"         TEXT,
  "discount_percentage" DECIMAL(5, 2)   NOT NULL DEFAULT 0,
  "is_active"           BOOLEAN         NOT NULL DEFAULT TRUE,
  "is_default"          BOOLEAN         NOT NULL DEFAULT FALSE,
  "is_package_unit"     BOOLEAN         NOT NULL DEFAULT FALSE,
  "sort_order"          INTEGER         NOT NULL DEFAULT 0,
  "created_at"          TIMESTAMP(6)    DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(6)    DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent FK + indexes for price_tiers
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_tiers_store_id_fkey'
  ) THEN
    ALTER TABLE "price_tiers"
      ADD CONSTRAINT "price_tiers_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "price_tiers_store_id_name_key"
  ON "price_tiers" ("store_id", "name");

CREATE INDEX IF NOT EXISTS "price_tiers_store_id_is_active_idx"
  ON "price_tiers" ("store_id", "is_active");

-- 2. product_price_tier_overrides table
CREATE TABLE IF NOT EXISTS "product_price_tier_overrides" (
  "id"             SERIAL         PRIMARY KEY,
  "product_id"     INTEGER        NOT NULL,
  "variant_id"     INTEGER,
  "price_tier_id"  INTEGER        NOT NULL,
  "override_price" DECIMAL(12, 2) NOT NULL,
  "created_at"     TIMESTAMP(6)   DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(6)   DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_price_tier_overrides_product_id_fkey'
  ) THEN
    ALTER TABLE "product_price_tier_overrides"
      ADD CONSTRAINT "product_price_tier_overrides_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id")
      ON UPDATE NO ACTION ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_price_tier_overrides_variant_id_fkey'
  ) THEN
    ALTER TABLE "product_price_tier_overrides"
      ADD CONSTRAINT "product_price_tier_overrides_variant_id_fkey"
      FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
      ON UPDATE NO ACTION ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_price_tier_overrides_price_tier_id_fkey'
  ) THEN
    ALTER TABLE "product_price_tier_overrides"
      ADD CONSTRAINT "product_price_tier_overrides_price_tier_id_fkey"
      FOREIGN KEY ("price_tier_id") REFERENCES "price_tiers"("id")
      ON UPDATE NO ACTION ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "product_price_tier_overrides_product_variant_tier_key"
  ON "product_price_tier_overrides" ("product_id", "variant_id", "price_tier_id");

CREATE INDEX IF NOT EXISTS "product_price_tier_overrides_price_tier_id_idx"
  ON "product_price_tier_overrides" ("price_tier_id");

-- 3. products: add multi-tarifa flag columns (nullable / safe defaults)
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "has_multiple_price_tiers" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "units_per_package" INTEGER;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "package_consumes_multiple_stock" BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. order_items: add snapshot columns + soft FK
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "applied_price_tier_id" INTEGER;

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "applied_price_tier_name_snapshot" VARCHAR(255);

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "stock_units_consumed" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_applied_price_tier_id_fkey'
  ) THEN
    ALTER TABLE "order_items"
      ADD CONSTRAINT "order_items_applied_price_tier_id_fkey"
      FOREIGN KEY ("applied_price_tier_id") REFERENCES "price_tiers"("id")
      ON UPDATE NO ACTION ON DELETE SET NULL;
  END IF;
END $$;

-- 5. quotation_items: add snapshot columns + soft FK
ALTER TABLE "quotation_items"
  ADD COLUMN IF NOT EXISTS "applied_price_tier_id" INTEGER;

ALTER TABLE "quotation_items"
  ADD COLUMN IF NOT EXISTS "applied_price_tier_name_snapshot" VARCHAR(255);

ALTER TABLE "quotation_items"
  ADD COLUMN IF NOT EXISTS "stock_units_consumed" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotation_items_applied_price_tier_id_fkey'
  ) THEN
    ALTER TABLE "quotation_items"
      ADD CONSTRAINT "quotation_items_applied_price_tier_id_fkey"
      FOREIGN KEY ("applied_price_tier_id") REFERENCES "price_tiers"("id")
      ON UPDATE NO ACTION ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

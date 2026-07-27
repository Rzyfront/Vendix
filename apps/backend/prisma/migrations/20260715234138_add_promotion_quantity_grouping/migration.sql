-- Migration: add quantity_grouping to promotions
--
-- Adds a new enum promotion_quantity_grouping_enum with two values:
--   cart_total (default, legacy): sum quantity across every line in scope
--   per_product:                  each product_id is evaluated independently
--
-- The new column has a default of 'cart_total' so existing promotions keep
-- their current behavior — no back-fill required. Promotions that want the
-- new behavior must opt in by setting quantity_grouping = 'per_product'.

-- 1) New enum
CREATE TYPE "promotion_quantity_grouping_enum" AS ENUM (
  'cart_total',
  'per_product'
);

-- 2) New column on promotions with default 'cart_total' (preserves legacy)
ALTER TABLE "promotions"
  ADD COLUMN "quantity_grouping" "promotion_quantity_grouping_enum" NOT NULL DEFAULT 'cart_total';

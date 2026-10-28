-- DATA IMPACT:
-- Tables affected: price_tiers gains adjustment_type (NOT NULL DEFAULT
--   'percent_discount'), adjustment_value (nullable) and amount_scope
--   (NOT NULL DEFAULT 'per_unit').
-- Expected row changes: none. Existing tiers read percent_discount and keep
--   pricing from discount_percentage exactly as before.
-- Destructive operations: none.
-- FK/cascade risk: none (no constraint added).
-- Idempotency: guarded CREATE TYPE, ADD COLUMN IF NOT EXISTS.
-- Approval: odd/tasks/price-tier-adjustments-customers.md (S1, S2, S10), L7.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'price_tier_adjustment_type_enum') THEN
    CREATE TYPE "price_tier_adjustment_type_enum" AS ENUM (
      'percent_discount',
      'percent_surcharge',
      'fixed_amount_discount',
      'fixed_amount_surcharge',
      'fixed_price'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'price_tier_amount_scope_enum') THEN
    CREATE TYPE "price_tier_amount_scope_enum" AS ENUM ('per_unit', 'per_package');
  END IF;
END $$;

ALTER TABLE "price_tiers"
  ADD COLUMN IF NOT EXISTS "adjustment_type" "price_tier_adjustment_type_enum" NOT NULL DEFAULT 'percent_discount',
  ADD COLUMN IF NOT EXISTS "adjustment_value" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "amount_scope" "price_tier_amount_scope_enum" NOT NULL DEFAULT 'per_unit';

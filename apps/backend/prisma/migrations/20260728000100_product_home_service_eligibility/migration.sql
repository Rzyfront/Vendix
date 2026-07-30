-- ============================================================================
-- Vendix — per-product home-service eligibility (phase 2)
-- ----------------------------------------------------------------------------
-- Adds:
--   * products.is_eligible_for_home_service BOOLEAN NOT NULL DEFAULT false
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Safe to re-run on partially-applied DB (P3009 recovery from skill
-- `vendix-prisma-migrations`).
--
-- No destructive ops. The default `false` preserves the legacy behavior:
-- existing products keep defaulting to "shop" until the operator opts
-- them in. Operators that already configured a specific product can
-- backfill via a one-off UPDATE outside this migration.
-- ============================================================================

-- 1. New column on products ------------------------------------------------
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "is_eligible_for_home_service"
    BOOLEAN NOT NULL DEFAULT false;

-- 2. Index for the product-list filter -------------------------------------
-- Light query today (the booking flow joins by id, not by flag), but
-- keeps the index available for future "filter products available at
-- home" UIs without an extra migration.
CREATE INDEX IF NOT EXISTS "products_is_eligible_for_home_service_idx"
  ON "products" ("is_eligible_for_home_service");
-- DATA IMPACT:
-- Tables affected: purchase_orders, purchase_order_items
-- Purpose: F1 IVA lifecycle — capture VAT on purchases (header + per-line),
--          persist net/tax per line, and prepare cost treatment by fiscal status.
-- New columns (all additive, nullable or defaulted — no existing column altered):
--   purchase_orders.prices_include_tax           BOOLEAN NOT NULL DEFAULT false
--   purchase_order_items.tax_rate                NUMERIC(5,2)  NULL
--   purchase_order_items.tax_type                tax_type_enum NULL DEFAULT 'iva'
--   purchase_order_items.prices_include_tax      BOOLEAN       NULL (per-line override)
--   purchase_order_items.unit_price_net          NUMERIC(12,4) NULL
--   purchase_order_items.tax_amount              NUMERIC(12,2) NULL
--   purchase_order_items.deductible_tax_amount   NUMERIC(12,2) NULL
--   purchase_order_items.capitalized_tax_amount  NUMERIC(12,2) NULL
-- Expected row changes: backfill only NULL values on legacy rows —
--   unit_price_net := unit_cost (existing cost column already holds NET cost),
--   tax_amount := 0, purchase_orders.prices_include_tax := false.
-- Destructive operations: NONE (no DROP / TRUNCATE / unqualified DELETE/UPDATE).
-- FK/cascade risk: none (no FK added or changed).
-- Idempotency: every statement guarded with IF NOT EXISTS / WHERE ... IS NULL.
-- Approval: F1 plan (IVA lifecycle) — additive, non-destructive.

-- ============================================================================
-- 1. purchase_orders: dominant invoice tax mode
-- ============================================================================
ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "prices_include_tax" BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- 2. purchase_order_items: per-line VAT capture
-- ============================================================================
ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "tax_rate" DECIMAL(5,2);

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "tax_type" "tax_type_enum" DEFAULT 'iva';

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "prices_include_tax" BOOLEAN;

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "unit_price_net" DECIMAL(12,4);

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "tax_amount" DECIMAL(12,2);

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "deductible_tax_amount" DECIMAL(12,2);

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "capitalized_tax_amount" DECIMAL(12,2);

-- ============================================================================
-- 3. Non-destructive backfill for legacy rows
--    `unit_cost` is the pre-F1 cost column and already holds the NET cost
--    (operators entered net cost; there was no tax concept before F1), so it
--    is the canonical source for `unit_price_net` on legacy lines.
-- ============================================================================
UPDATE "purchase_order_items"
  SET "unit_price_net" = "unit_cost"
  WHERE "unit_price_net" IS NULL;

UPDATE "purchase_order_items"
  SET "tax_amount" = 0
  WHERE "tax_amount" IS NULL;

-- Explicit for legacy rows even though the column default already covers new
-- inserts (a pre-existing row created before the column existed picked up the
-- DEFAULT, but be explicit in case any driver path left it NULL).
UPDATE "purchase_orders"
  SET "prices_include_tax" = false
  WHERE "prices_include_tax" IS NULL;

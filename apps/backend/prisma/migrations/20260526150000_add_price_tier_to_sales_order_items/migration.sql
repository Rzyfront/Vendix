-- DATA IMPACT:
--   Tables affected:
--     - sales_order_items                  (ADD nullable columns: applied_price_tier_id,
--                                           applied_price_tier_name_snapshot, stock_units_consumed)
--   Expected row changes:
--     - No UPDATE/DELETE of existing rows. Existing sales_order_items keep
--       applied_price_tier_id = NULL and applied_price_tier_name_snapshot = NULL.
--   Destructive operations: none (no DROP, no TRUNCATE, no CASCADE, no unscoped DELETE/UPDATE).
--   FK/cascade risk:
--     - sales_order_items.applied_price_tier_id FK uses ON DELETE SET NULL so
--       deleting a price tier never destroys historical line items; the
--       applied_price_tier_name_snapshot column preserves the human label.
--   Idempotency: guarded with IF NOT EXISTS and pg_constraint pre-checks; safe
--     to re-run.
--   Approval: Phase 1.5 of approved plan
--     plans/quiero-que-hagas-un-polished-sparrow.md (multi-price tier system),
--     follow-up patch to align sales_order_items with order_items /
--     quotation_items (POS uses sales-orders path).

BEGIN;

-- 1. sales_order_items: add snapshot columns (nullable, no defaults that touch rows)
ALTER TABLE "sales_order_items"
  ADD COLUMN IF NOT EXISTS "applied_price_tier_id" INTEGER;

ALTER TABLE "sales_order_items"
  ADD COLUMN IF NOT EXISTS "applied_price_tier_name_snapshot" VARCHAR(255);

ALTER TABLE "sales_order_items"
  ADD COLUMN IF NOT EXISTS "stock_units_consumed" INTEGER;

-- 2. Soft FK to price_tiers with ON DELETE SET NULL (audit-preservation)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_items_applied_price_tier_id_fkey'
  ) THEN
    ALTER TABLE "sales_order_items"
      ADD CONSTRAINT "sales_order_items_applied_price_tier_id_fkey"
      FOREIGN KEY ("applied_price_tier_id") REFERENCES "price_tiers"("id")
      ON UPDATE NO ACTION ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

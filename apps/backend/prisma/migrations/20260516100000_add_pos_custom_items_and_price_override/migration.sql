-- DATA IMPACT:
-- Tables affected: products, order_items
-- Expected row changes: none; adds nullable/defaulted columns only
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by IF NOT EXISTS
-- Approval: requested and approved in chat with "dale"

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "allow_pos_price_override" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "catalog_unit_price" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "catalog_final_price" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "final_unit_price" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "is_price_overridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "price_override_reason" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "price_overridden_by_user_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "description" TEXT;

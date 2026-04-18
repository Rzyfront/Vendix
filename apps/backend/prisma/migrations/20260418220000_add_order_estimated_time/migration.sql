-- Add estimated time (ETA) system for orders
-- Supports: per-product preparation time, per-shipping-method transit time,
-- and computed ETA fields on orders (ready_at + delivered_at).
-- All operations idempotent and safe for production (nullable or DEFAULT-backed).

-- 1. Product preparation time (per-product override, nullable falls back to store default)
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "preparation_time_minutes" INTEGER;

-- 2. Shipping method transit time (NOT NULL with DEFAULT 0 → PostgreSQL 11+ applies in O(1) without table rewrite)
ALTER TABLE "shipping_methods"
  ADD COLUMN IF NOT EXISTS "transit_time_minutes" INTEGER NOT NULL DEFAULT 0;

-- 3. Order ETA fields (nullable, populated on payOrder())
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "estimated_ready_at" TIMESTAMP(3);

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "estimated_delivered_at" TIMESTAMP(3);

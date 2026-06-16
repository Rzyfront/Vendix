-- =====================================================================
-- Fase 2 (insumos-vs-retail consolidation): add `order_type` to
-- purchase_orders and UoM FKs to purchase_order_items.
--
-- Plan: "Orden de compra con tipo primario (insumo | retail) que define
-- captura + perfil de scan. Mixto por línea = fuera de alcance V1."
--
-- All changes are non-destructive:
--   * `order_type` defaults to `retail` for backward compat (legacy rows
--     with NULL behave as retail at the application layer).
--   * `purchase_uom_id` / `stock_uom_id` are nullable; retail orders do
--     not need them.
--
-- Idempotent: guards with IF NOT EXISTS / IF EXISTS so this can be
-- re-applied manually if a previous attempt left the columns half-built.
-- =====================================================================

-- 1) New enum (Postgres: CREATE TYPE has no IF NOT EXISTS; do it once)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_type_enum') THEN
    CREATE TYPE purchase_order_type_enum AS ENUM ('retail', 'ingredient');
  END IF;
END
$$;

-- 2) purchase_orders.order_type (nullable, default 'retail')
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS order_type purchase_order_type_enum DEFAULT 'retail';

-- 3) purchase_order_items UoM FKs (nullable, no FK constraint here to
--    avoid blocking partial deployments; the service layer validates
--    referential integrity via the UoM catalog helper).
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS purchase_uom_id INTEGER,
  ADD COLUMN IF NOT EXISTS stock_uom_id INTEGER;

-- 4) Backfill safety: keep existing rows as retail (the default already
--    does this). No data migration required.

-- 5) Index for the common "list my ingredient orders" query.
CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_type
  ON purchase_orders (organization_id, order_type);

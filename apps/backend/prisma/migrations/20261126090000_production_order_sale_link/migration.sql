-- QUI-995 — production orders linked to the sale that originated them.
-- A sale line sent to Production (fulfillment_destination = 'production') gets one
-- production order per product and sale. Manual and Planta orders keep order_id NULL;
-- NULLs never collide in the unique index.
--
-- DATA IMPACT:
-- Tables affected: production_orders (new nullable column, FK, unique + plain index)
-- Expected row changes: none (existing rows read NULL; no backfill)
-- Destructive operations: none
-- FK/cascade risk: FK to orders with ON DELETE NO ACTION (never cascades)
-- Idempotency: ADD COLUMN IF NOT EXISTS, guarded FK via pg_constraint, CREATE INDEX IF NOT EXISTS
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "order_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_order_id_fkey'
  ) THEN
    ALTER TABLE "production_orders"
      ADD CONSTRAINT "production_orders_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "production_orders_order_id_product_id_key"
  ON "production_orders"("order_id", "product_id");

CREATE INDEX IF NOT EXISTS "production_orders_store_id_order_id_idx"
  ON "production_orders"("store_id", "order_id");

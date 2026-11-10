-- DATA IMPACT: none (new nullable column, new index, index swap; no row changes)
-- Tables affected: production_orders (DDL only)
-- Expected row changes: 0
-- Destructive operations: none. The new index is PARTIAL (order_id IS NOT NULL): it only
--   covers sale-linked rows, which were already unique per (order_id, product_id) under the
--   replaced index, so every existing sale-linked row satisfies it. Manual/Planta orders keep
--   order_id NULL and are not covered, so repeated manual orders of one product stay valid.
-- FK/cascade risk: new FK is ON DELETE NO ACTION
-- Idempotency: IF NOT EXISTS / pg_constraint guards
-- Precondition: PostgreSQL 15+ (NULLS NOT DISTINCT, same as 20260818140000_cart_items_sale_unit)
--
-- QUI-995: one production order per product+variant of a sale. Variant lines
-- keep their own order so the completion credits and reserves the SOLD variant.

ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "product_variant_id" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_product_variant_id_fkey'
  ) THEN
    ALTER TABLE "production_orders"
      ADD CONSTRAINT "production_orders_product_variant_id_fkey"
      FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- NULLS NOT DISTINCT: base products store a NULL variant; without it two NULLs never
-- collide and the index would protect nothing for them.
-- WHERE order_id IS NOT NULL: NULLS NOT DISTINCT would otherwise also equate order_id NULLs
-- and reject a second manual order of the same product (and abort the deploy if prod
-- already has two).
CREATE UNIQUE INDEX IF NOT EXISTS "production_orders_order_id_product_id_product_variant_id_key"
  ON "production_orders"("order_id", "product_id", "product_variant_id")
  NULLS NOT DISTINCT
  WHERE "order_id" IS NOT NULL;

DROP INDEX IF EXISTS "production_orders_order_id_product_id_key";

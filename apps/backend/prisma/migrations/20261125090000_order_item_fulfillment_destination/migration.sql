-- QUI-999: fulfillment destination (kds / production / stock) per restaurant sale line.
-- DATA IMPACT: no rows modified (additive nullable column + new enum type).
-- Tables affected: order_items (new column only). Existing rows keep NULL, which the
-- application treats as "behave as before". Destructive operations: none.
-- FK/cascade risk: none. Idempotency: guarded by pg_type check and ADD COLUMN IF NOT EXISTS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_item_fulfillment_destination_enum') THEN
    CREATE TYPE "order_item_fulfillment_destination_enum" AS ENUM ('kds', 'production', 'stock');
  END IF;
END $$;

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "fulfillment_destination" "order_item_fulfillment_destination_enum";

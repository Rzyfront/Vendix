-- Add track_inventory_override field to product_variants
-- Allows overriding inventory tracking at variant level

-- 1. Add column (idempotent)
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "track_inventory_override" BOOLEAN;

-- 2. Partial index for efficient queries on overridden variants
CREATE INDEX IF NOT EXISTS "idx_product_variants_track_inventory_override" 
ON "product_variants"("track_inventory_override") 
WHERE "track_inventory_override" IS NOT NULL;

-- 3. Check constraints for sale fields (NOT VALID - only enforces on new rows)
-- This preserves historical data while ensuring future data integrity
ALTER TABLE "product_variants" ADD CONSTRAINT "chk_product_variants_sale_price_requires_sale" 
CHECK (is_on_sale = false OR sale_price IS NOT NULL) NOT VALID;

ALTER TABLE "products" ADD CONSTRAINT "chk_products_sale_price_requires_sale" 
CHECK (is_on_sale = false OR sale_price IS NOT NULL) NOT VALID;

-- 4. Check constraints for sale_price > 0 when is_on_sale=true (NOT VALID)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_variants_sale_price_positive'
  ) THEN
    ALTER TABLE "product_variants" ADD CONSTRAINT "chk_product_variants_sale_price_positive"
      CHECK (NOT is_on_sale OR sale_price > 0) NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_sale_price_positive'
  ) THEN
    ALTER TABLE "products" ADD CONSTRAINT "chk_products_sale_price_positive"
      CHECK (NOT is_on_sale OR sale_price > 0) NOT VALID;
  END IF;
END
$$;

-- AlterTable: Drop global unique constraint on SKU
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_sku_key";

-- AlterTable: Add composite unique constraint for store_id + sku
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_sku_key" UNIQUE ("store_id", "sku");

-- CreateIndex: Add index for performance
CREATE INDEX IF NOT EXISTS "products_store_id_sku_idx" ON "products"("store_id", "sku");

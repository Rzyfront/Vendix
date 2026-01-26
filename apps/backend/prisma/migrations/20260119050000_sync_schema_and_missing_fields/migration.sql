-- DropIndex
DROP INDEX IF EXISTS "tax_categories_name_key";

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "cost_price" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "is_on_sale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "profit_margin" DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS "sale_price" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cost_price" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "dimensions" JSONB,
ADD COLUMN IF NOT EXISTS "max_stock_level" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "min_stock_level" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "profit_margin" DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS "reorder_point" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reorder_quantity" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "requires_batch_tracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "requires_serial_numbers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "track_inventory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "weight" DECIMAL(12,3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tax_categories_store_id_name_key" ON "tax_categories"("store_id", "name");

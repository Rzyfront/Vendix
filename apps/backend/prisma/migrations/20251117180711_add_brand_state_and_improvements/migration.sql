-- CreateEnum
CREATE TYPE "brand_state_enum" AS ENUM ('active', 'inactive', 'archived');

-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "state" "brand_state_enum" NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE INDEX "stock_levels_product_id_location_id_idx" ON "stock_levels"("product_id", "location_id");

-- CreateIndex
CREATE INDEX "stock_levels_product_id_idx" ON "stock_levels"("product_id");

-- CreateIndex
CREATE INDEX "stock_levels_location_id_quantity_available_idx" ON "stock_levels"("location_id", "quantity_available");

-- CreateIndex
CREATE INDEX "stock_levels_quantity_available_reorder_point_idx" ON "stock_levels"("quantity_available", "reorder_point");

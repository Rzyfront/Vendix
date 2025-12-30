/*
  Warnings:

  - A unique constraint covering the columns `[product_id,sku]` on the table `product_variants` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "product_variants_sku_key";

-- DropIndex
DROP INDEX "products_sku_key";

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_sku_key" ON "product_variants"("product_id", "sku");

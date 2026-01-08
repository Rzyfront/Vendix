/*
  Warnings:

  - You are about to drop the column `alt_text` on the `product_images` table. All the data in the column will be lost.
  - You are about to drop the column `sort_order` on the `product_images` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[store_id,order_number]` on the table `orders` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "orders_order_number_key";

-- AlterTable
ALTER TABLE "product_images" DROP COLUMN "alt_text",
DROP COLUMN "sort_order";

-- CreateIndex
CREATE INDEX "orders_store_id_order_number_idx" ON "orders"("store_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_store_id_order_number_key" ON "orders"("store_id", "order_number");

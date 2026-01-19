-- AlterTable
ALTER TABLE "products" ADD COLUMN     "is_on_sale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sale_price" DECIMAL(12,2);

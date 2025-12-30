-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "batch_number" VARCHAR(100),
ADD COLUMN     "expiration_date" TIMESTAMP(6),
ADD COLUMN     "manufacturing_date" TIMESTAMP(6);

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "internal_notes" TEXT;

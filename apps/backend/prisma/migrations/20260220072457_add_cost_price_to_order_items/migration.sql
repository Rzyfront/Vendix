-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "cost_price" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "cost_price" DECIMAL(12,2);

-- CreateEnum
CREATE TYPE "order_channel_enum" AS ENUM ('pos', 'ecommerce', 'agent', 'whatsapp', 'marketplace');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "channel" "order_channel_enum" NOT NULL DEFAULT 'pos';

-- Backfill: Ecommerce orders have pattern STORE_CODE-YYMMDD-NNNN (e.g., EC-240201-0001)
-- POS orders have pattern POS-YYYY-NNNN (e.g., POS-2024-0001)
UPDATE "orders" SET "channel" = 'ecommerce'
WHERE "order_number" ~ '^[A-Z]+-[0-9]{6}-[0-9]+$';

-- CreateIndex
CREATE INDEX "orders_store_id_channel_idx" ON "orders"("store_id", "channel");

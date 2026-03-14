-- AlterTable: Add customer_id to order_promotions
ALTER TABLE "order_promotions" ADD COLUMN "customer_id" INTEGER;

-- Backfill: Copy customer_id from orders
UPDATE "order_promotions" op
SET "customer_id" = o."customer_id"
FROM "orders" o
WHERE op."order_id" = o."id";

-- CreateIndex: Composite index for per-customer limit lookups
CREATE INDEX "order_promotions_promotion_id_customer_id_idx"
  ON "order_promotions"("promotion_id", "customer_id");

-- AddForeignKey
ALTER TABLE "order_promotions"
  ADD CONSTRAINT "order_promotions_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

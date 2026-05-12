-- DropIndex
DROP INDEX "idx_product_variants_track_inventory_override";

-- DropIndex
DROP INDEX "store_subscriptions_promotional_plan_id_idx";

-- DropIndex
DROP INDEX "idx_stores_operating_hours";

-- DropIndex
DROP INDEX "subscription_plans_unique_default_active";

-- AlterTable
ALTER TABLE "store_subscriptions" ADD COLUMN     "scheduled_cancel_at" TIMESTAMP(6);

-- CreateIndex
CREATE INDEX "store_subscriptions_promotional_plan_id_idx" ON "store_subscriptions"("promotional_plan_id");

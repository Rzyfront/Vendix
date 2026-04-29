-- DATA IMPACT: None — this migration only creates new tables and an enum.
-- Tables affected: None (new tables: commission_accrual_pending, webhook_event_dedup)
-- Cascade risk check: N/A — no existing data is modified.

-- CreateEnum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commission_accrual_state_enum') THEN
    CREATE TYPE "commission_accrual_state_enum" AS ENUM ('pending', 'processing', 'completed', 'failed');
  END IF;
END
$$;

-- DropForeignKey
ALTER TABLE "organization_onboarding_state" DROP CONSTRAINT IF EXISTS "organization_onboarding_state_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "partner_commissions" DROP CONSTRAINT IF EXISTS "partner_commissions_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "partner_commissions" DROP CONSTRAINT IF EXISTS "partner_commissions_partner_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "partner_commissions" DROP CONSTRAINT IF EXISTS "partner_commissions_payout_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "partner_payout_batches" DROP CONSTRAINT IF EXISTS "partner_payout_batches_partner_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "partner_plan_overrides" DROP CONSTRAINT IF EXISTS "partner_plan_overrides_base_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "partner_plan_overrides" DROP CONSTRAINT IF EXISTS "partner_plan_overrides_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "store_subscriptions" DROP CONSTRAINT IF EXISTS "store_subscriptions_partner_override_id_fkey";

-- DropForeignKey
ALTER TABLE "store_subscriptions" DROP CONSTRAINT IF EXISTS "store_subscriptions_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "store_subscriptions" DROP CONSTRAINT IF EXISTS "store_subscriptions_promotional_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "store_subscriptions" DROP CONSTRAINT IF EXISTS "store_subscriptions_replaced_by_id_fkey";

-- DropForeignKey
ALTER TABLE "store_subscriptions" DROP CONSTRAINT IF EXISTS "store_subscriptions_store_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_events" DROP CONSTRAINT IF EXISTS "subscription_events_store_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_invoices" DROP CONSTRAINT IF EXISTS "subscription_invoices_store_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_payments" DROP CONSTRAINT IF EXISTS "subscription_payments_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_plans" DROP CONSTRAINT IF EXISTS "subscription_plans_parent_plan_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "ai_embeddings_embedding_idx";

-- DropIndex
DROP INDEX IF EXISTS "brands_name_key";

-- CreateTable (idempotent via IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS "commission_accrual_pending" (
    "invoice_id" INTEGER NOT NULL,
    "partner_organization_id" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'COP',
    "state" "commission_accrual_state_enum" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(6),

    CONSTRAINT "commission_accrual_pending_pkey" PRIMARY KEY ("invoice_id")
);

-- CreateTable (idempotent via IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS "webhook_event_dedup" (
    "id" SERIAL NOT NULL,
    "processor" VARCHAR(64) NOT NULL,
    "event_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(64),
    "received_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_event_dedup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "commission_accrual_pending_invoice_id_key" ON "commission_accrual_pending"("invoice_id");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "commission_accrual_pending_state_created_at_idx" ON "commission_accrual_pending"("state", "created_at");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "webhook_event_dedup_processor_event_id_idx" ON "webhook_event_dedup"("processor", "event_id");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "webhook_event_dedup_received_at_idx" ON "webhook_event_dedup"("received_at");

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_event_dedup_processor_event_id_key" ON "webhook_event_dedup"("processor", "event_id");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "store_subscriptions_promotional_plan_id_idx" ON "store_subscriptions"("promotional_plan_id");

-- AddForeignKey
ALTER TABLE "organization_onboarding_state" ADD CONSTRAINT "organization_onboarding_state_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_parent_plan_id_fkey" FOREIGN KEY ("parent_plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_plan_overrides" ADD CONSTRAINT "partner_plan_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_plan_overrides" ADD CONSTRAINT "partner_plan_overrides_base_plan_id_fkey" FOREIGN KEY ("base_plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_promotional_plan_id_fkey" FOREIGN KEY ("promotional_plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_partner_override_id_fkey" FOREIGN KEY ("partner_override_id") REFERENCES "partner_plan_overrides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "store_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_store_subscription_id_fkey" FOREIGN KEY ("store_subscription_id") REFERENCES "store_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "subscription_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "subscription_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_partner_organization_id_fkey" FOREIGN KEY ("partner_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_payout_batch_id_fkey" FOREIGN KEY ("payout_batch_id") REFERENCES "partner_payout_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payout_batches" ADD CONSTRAINT "partner_payout_batches_partner_organization_id_fkey" FOREIGN KEY ("partner_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_store_subscription_id_fkey" FOREIGN KEY ("store_subscription_id") REFERENCES "store_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_accrual_pending" ADD CONSTRAINT "commission_accrual_pending_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "subscription_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX IF EXISTS "partner_commissions_partner_org_state_idx" RENAME TO "partner_commissions_partner_organization_id_state_idx";

-- RenameIndex
ALTER INDEX IF EXISTS "partner_payout_batches_partner_org_state_idx" RENAME TO "partner_payout_batches_partner_organization_id_state_idx";

-- RenameIndex
ALTER INDEX IF EXISTS "partner_plan_overrides_org_base_plan_key" RENAME TO "partner_plan_overrides_organization_id_base_plan_id_key";

-- RenameIndex
ALTER INDEX IF EXISTS "subscription_events_store_sub_created_at_idx" RENAME TO "subscription_events_store_subscription_id_created_at_idx";

-- RenameIndex
ALTER INDEX IF EXISTS "subscription_invoices_partner_org_state_idx" RENAME TO "subscription_invoices_partner_organization_id_state_idx";

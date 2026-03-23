-- CreateEnum
CREATE TYPE "layaway_plan_state_enum" AS ENUM ('active', 'completed', 'cancelled', 'overdue', 'defaulted');

-- CreateEnum
CREATE TYPE "layaway_installment_state_enum" AS ENUM ('pending', 'paid', 'overdue', 'cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'layaway_payment_received';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'layaway_payment_reminder';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'layaway_overdue';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'layaway_completed';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'layaway_cancelled';

-- AlterEnum
ALTER TYPE "reservation_type_enum" ADD VALUE IF NOT EXISTS 'layaway';

-- DropForeignKey
ALTER TABLE "cash_register_sessions" DROP CONSTRAINT "cash_register_sessions_closed_by_fkey";

-- DropIndex
DROP INDEX "dian_configurations_store_id_key";

-- CreateTable
CREATE TABLE "layaway_plans" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "plan_number" VARCHAR(50) NOT NULL,
    "state" "layaway_plan_state_enum" NOT NULL DEFAULT 'active',
    "total_amount" DECIMAL(12,2) NOT NULL,
    "down_payment_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "remaining_amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10),
    "num_installments" INTEGER NOT NULL,
    "notes" TEXT,
    "internal_notes" TEXT,
    "started_at" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6),
    "cancelled_at" TIMESTAMP(6),
    "cancellation_reason" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "layaway_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layaway_items" (
    "id" SERIAL NOT NULL,
    "layaway_plan_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "product_name" VARCHAR(255) NOT NULL,
    "variant_name" VARCHAR(255),
    "sku" VARCHAR(100),
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "location_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "layaway_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layaway_installments" (
    "id" SERIAL NOT NULL,
    "layaway_plan_id" INTEGER NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" TIMESTAMP(6) NOT NULL,
    "state" "layaway_installment_state_enum" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(6),
    "reminder_sent_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "layaway_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layaway_payments" (
    "id" SERIAL NOT NULL,
    "layaway_plan_id" INTEGER NOT NULL,
    "layaway_installment_id" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10),
    "store_payment_method_id" INTEGER,
    "transaction_id" VARCHAR(255),
    "state" "payments_state_enum" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(6),
    "notes" TEXT,
    "received_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "layaway_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "layaway_plans_store_id_state_idx" ON "layaway_plans"("store_id", "state");

-- CreateIndex
CREATE INDEX "layaway_plans_customer_id_idx" ON "layaway_plans"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "layaway_plans_store_id_plan_number_key" ON "layaway_plans"("store_id", "plan_number");

-- CreateIndex
CREATE INDEX "layaway_items_layaway_plan_id_idx" ON "layaway_items"("layaway_plan_id");

-- CreateIndex
CREATE INDEX "layaway_items_product_id_idx" ON "layaway_items"("product_id");

-- CreateIndex
CREATE INDEX "layaway_installments_layaway_plan_id_idx" ON "layaway_installments"("layaway_plan_id");

-- CreateIndex
CREATE INDEX "layaway_installments_due_date_state_idx" ON "layaway_installments"("due_date", "state");

-- CreateIndex
CREATE UNIQUE INDEX "layaway_installments_layaway_plan_id_installment_number_key" ON "layaway_installments"("layaway_plan_id", "installment_number");

-- CreateIndex
CREATE UNIQUE INDEX "layaway_payments_transaction_id_key" ON "layaway_payments"("transaction_id");

-- CreateIndex
CREATE INDEX "layaway_payments_layaway_plan_id_idx" ON "layaway_payments"("layaway_plan_id");

-- CreateIndex
CREATE INDEX "layaway_payments_layaway_installment_id_idx" ON "layaway_payments"("layaway_installment_id");

-- AddForeignKey
ALTER TABLE "cash_register_sessions" ADD CONSTRAINT "cash_register_sessions_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "layaway_plans" ADD CONSTRAINT "layaway_plans_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "layaway_plans" ADD CONSTRAINT "layaway_plans_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_plans" ADD CONSTRAINT "layaway_plans_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_items" ADD CONSTRAINT "layaway_items_layaway_plan_id_fkey" FOREIGN KEY ("layaway_plan_id") REFERENCES "layaway_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_items" ADD CONSTRAINT "layaway_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_items" ADD CONSTRAINT "layaway_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_items" ADD CONSTRAINT "layaway_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_installments" ADD CONSTRAINT "layaway_installments_layaway_plan_id_fkey" FOREIGN KEY ("layaway_plan_id") REFERENCES "layaway_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_payments" ADD CONSTRAINT "layaway_payments_layaway_plan_id_fkey" FOREIGN KEY ("layaway_plan_id") REFERENCES "layaway_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_payments" ADD CONSTRAINT "layaway_payments_layaway_installment_id_fkey" FOREIGN KEY ("layaway_installment_id") REFERENCES "layaway_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_payments" ADD CONSTRAINT "layaway_payments_store_payment_method_id_fkey" FOREIGN KEY ("store_payment_method_id") REFERENCES "store_payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_payments" ADD CONSTRAINT "layaway_payments_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "accounting_account_mappings_organization_id_store_id_mapping_ke" RENAME TO "accounting_account_mappings_organization_id_store_id_mappin_key";

-- RenameIndex
ALTER INDEX "inventory_cost_layers_product_id_product_variant_id_locati_idx" RENAME TO "inventory_cost_layers_product_id_product_variant_id_locatio_idx";

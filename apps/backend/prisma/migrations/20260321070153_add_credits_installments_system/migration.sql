-- CreateEnum
CREATE TYPE "credit_state_enum" AS ENUM ('pending', 'active', 'paid', 'overdue', 'cancelled', 'defaulted');

-- CreateEnum
CREATE TYPE "installment_state_enum" AS ENUM ('pending', 'paid', 'overdue', 'partial', 'forgiven');

-- CreateEnum
CREATE TYPE "installment_frequency_enum" AS ENUM ('weekly', 'biweekly', 'monthly');

-- AlterEnum (idempotent)
ALTER TYPE "accounting_entry_type_enum" ADD VALUE IF NOT EXISTS 'auto_installment_payment';

-- AlterEnum (idempotent)
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'installment_reminder';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'installment_overdue';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'installment_paid';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'credit_completed';

-- AlterTable: Add credit_limit to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credit_limit" DECIMAL(12,2);

-- CreateTable: credits
CREATE TABLE "credits" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "credit_number" VARCHAR(50) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "total_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remaining_balance" DECIMAL(12,2) NOT NULL,
    "num_installments" INTEGER NOT NULL,
    "installment_value" DECIMAL(12,2) NOT NULL,
    "frequency" "installment_frequency_enum" NOT NULL,
    "interest_rate" DECIMAL(5,4) DEFAULT 0,
    "start_date" TIMESTAMP(6) NOT NULL,
    "first_installment_date" TIMESTAMP(6) NOT NULL,
    "state" "credit_state_enum" NOT NULL DEFAULT 'pending',
    "default_payment_method_id" INTEGER,
    "notes" VARCHAR(500),
    "created_by_user_id" INTEGER,
    "completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable: credit_installments
CREATE TABLE "credit_installments" (
    "id" SERIAL NOT NULL,
    "credit_id" INTEGER NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "installment_value" DECIMAL(12,2) NOT NULL,
    "capital_value" DECIMAL(12,2) NOT NULL,
    "interest_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remaining_balance" DECIMAL(12,2) NOT NULL,
    "due_date" TIMESTAMP(6) NOT NULL,
    "payment_date" TIMESTAMP(6),
    "state" "installment_state_enum" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: credit_installment_payments
CREATE TABLE "credit_installment_payments" (
    "id" SERIAL NOT NULL,
    "installment_id" INTEGER NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMP(6) NOT NULL,
    "store_payment_method_id" INTEGER,
    "payment_reference" VARCHAR(255),
    "registered_by_user_id" INTEGER,
    "accounting_entry_id" INTEGER,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_installment_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credits_store_id_state_idx" ON "credits"("store_id", "state");
CREATE INDEX "credits_store_id_customer_id_idx" ON "credits"("store_id", "customer_id");
CREATE INDEX "credits_order_id_idx" ON "credits"("order_id");
CREATE UNIQUE INDEX "credits_store_id_credit_number_key" ON "credits"("store_id", "credit_number");

-- CreateIndex
CREATE INDEX "credit_installments_credit_id_state_idx" ON "credit_installments"("credit_id", "state");
CREATE INDEX "credit_installments_due_date_state_idx" ON "credit_installments"("due_date", "state");
CREATE UNIQUE INDEX "credit_installments_credit_id_installment_number_key" ON "credit_installments"("credit_id", "installment_number");

-- AddForeignKey: credits
ALTER TABLE "credits" ADD CONSTRAINT "credits_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "credits" ADD CONSTRAINT "credits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "credits" ADD CONSTRAINT "credits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "credits" ADD CONSTRAINT "credits_default_payment_method_id_fkey" FOREIGN KEY ("default_payment_method_id") REFERENCES "store_payment_methods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "credits" ADD CONSTRAINT "credits_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey: credit_installments
ALTER TABLE "credit_installments" ADD CONSTRAINT "credit_installments_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: credit_installment_payments
ALTER TABLE "credit_installment_payments" ADD CONSTRAINT "credit_installment_payments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "credit_installments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "credit_installment_payments" ADD CONSTRAINT "credit_installment_payments_store_payment_method_id_fkey" FOREIGN KEY ("store_payment_method_id") REFERENCES "store_payment_methods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "credit_installment_payments" ADD CONSTRAINT "credit_installment_payments_registered_by_user_id_fkey" FOREIGN KEY ("registered_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "credit_installment_payments" ADD CONSTRAINT "credit_installment_payments_accounting_entry_id_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

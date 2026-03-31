-- CreateEnum: payment_agreement_state_enum
CREATE TYPE "payment_agreement_state_enum" AS ENUM ('active', 'completed', 'defaulted', 'cancelled');

-- CreateTable: accounts_receivable
CREATE TABLE "accounts_receivable" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "source_type" VARCHAR(50) NOT NULL,
    "source_id" INTEGER,
    "document_number" VARCHAR(100),
    "original_amount" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "balance" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "days_overdue" INTEGER NOT NULL DEFAULT 0,
    "last_payment_date" TIMESTAMP(6),
    "notes" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ar_payments
CREATE TABLE "ar_payments" (
    "id" SERIAL NOT NULL,
    "accounts_receivable_id" INTEGER NOT NULL,
    "payment_id" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMP(6) NOT NULL,
    "payment_method" VARCHAR(50),
    "reference" VARCHAR(255),
    "notes" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: payment_agreements
CREATE TABLE "payment_agreements" (
    "id" SERIAL NOT NULL,
    "accounts_receivable_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "agreement_number" VARCHAR(50) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "num_installments" INTEGER NOT NULL,
    "interest_rate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "state" "payment_agreement_state_enum" NOT NULL DEFAULT 'active',
    "start_date" DATE NOT NULL,
    "notes" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable: agreement_installments
CREATE TABLE "agreement_installments" (
    "id" SERIAL NOT NULL,
    "payment_agreement_id" INTEGER NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_receivable_store_id_customer_id_idx" ON "accounts_receivable"("store_id", "customer_id");
CREATE INDEX "accounts_receivable_store_id_status_idx" ON "accounts_receivable"("store_id", "status");
CREATE INDEX "accounts_receivable_due_date_status_idx" ON "accounts_receivable"("due_date", "status");
CREATE INDEX "ar_payments_accounts_receivable_id_idx" ON "ar_payments"("accounts_receivable_id");
CREATE INDEX "payment_agreements_accounts_receivable_id_idx" ON "payment_agreements"("accounts_receivable_id");
CREATE INDEX "payment_agreements_store_id_idx" ON "payment_agreements"("store_id");
CREATE UNIQUE INDEX "agreement_installments_payment_agreement_id_installment_numb_key" ON "agreement_installments"("payment_agreement_id", "installment_number");
CREATE INDEX "agreement_installments_due_date_state_idx" ON "agreement_installments"("due_date", "state");

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_accounts_receivable_id_fkey" FOREIGN KEY ("accounts_receivable_id") REFERENCES "accounts_receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_agreements" ADD CONSTRAINT "payment_agreements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_agreements" ADD CONSTRAINT "payment_agreements_accounts_receivable_id_fkey" FOREIGN KEY ("accounts_receivable_id") REFERENCES "accounts_receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agreement_installments" ADD CONSTRAINT "agreement_installments_payment_agreement_id_fkey" FOREIGN KEY ("payment_agreement_id") REFERENCES "payment_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

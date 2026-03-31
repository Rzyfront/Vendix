-- CreateTable: accounts_payable
CREATE TABLE "accounts_payable" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "supplier_id" INTEGER NOT NULL,
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
    "priority" VARCHAR(20) NOT NULL DEFAULT 'normal',
    "notes" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ap_payments
CREATE TABLE "ap_payments" (
    "id" SERIAL NOT NULL,
    "accounts_payable_id" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMP(6) NOT NULL,
    "payment_method" VARCHAR(50) NOT NULL,
    "reference" VARCHAR(255),
    "bank_export_ref" VARCHAR(100),
    "notes" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ap_payment_schedules
CREATE TABLE "ap_payment_schedules" (
    "id" SERIAL NOT NULL,
    "accounts_payable_id" INTEGER NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    "processed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_payable_organization_id_supplier_id_idx" ON "accounts_payable"("organization_id", "supplier_id");
CREATE INDEX "accounts_payable_due_date_status_idx" ON "accounts_payable"("due_date", "status");
CREATE INDEX "ap_payments_accounts_payable_id_idx" ON "ap_payments"("accounts_payable_id");
CREATE INDEX "ap_payment_schedules_scheduled_date_status_idx" ON "ap_payment_schedules"("scheduled_date", "status");

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_accounts_payable_id_fkey" FOREIGN KEY ("accounts_payable_id") REFERENCES "accounts_payable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ap_payment_schedules" ADD CONSTRAINT "ap_payment_schedules_accounts_payable_id_fkey" FOREIGN KEY ("accounts_payable_id") REFERENCES "accounts_payable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

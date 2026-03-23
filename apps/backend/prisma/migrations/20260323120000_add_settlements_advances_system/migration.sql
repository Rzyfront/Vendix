-- CreateEnum: termination_reason_enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'termination_reason_enum') THEN
    CREATE TYPE "termination_reason_enum" AS ENUM ('voluntary_resignation', 'just_cause', 'without_just_cause', 'mutual_agreement', 'contract_expiry', 'retirement', 'death');
  END IF;
END
$$;

-- CreateEnum: settlement_status_enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'settlement_status_enum') THEN
    CREATE TYPE "settlement_status_enum" AS ENUM ('draft', 'calculated', 'approved', 'paid', 'cancelled');
  END IF;
END
$$;

-- CreateEnum: employee_advance_status_enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employee_advance_status_enum') THEN
    CREATE TYPE "employee_advance_status_enum" AS ENUM ('pending', 'approved', 'repaying', 'paid', 'rejected', 'cancelled');
  END IF;
END
$$;

-- CreateEnum: dian_configuration_type_enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dian_configuration_type_enum') THEN
    CREATE TYPE "dian_configuration_type_enum" AS ENUM ('invoicing', 'payroll');
  END IF;
END
$$;

-- AlterTable: employees - add termination_reason
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "termination_reason" "termination_reason_enum";

-- AlterTable: payroll_items - add paystub_url
ALTER TABLE "payroll_items" ADD COLUMN IF NOT EXISTS "paystub_url" TEXT;

-- AlterTable: dian_configurations - add configuration_type
ALTER TABLE "dian_configurations" ADD COLUMN IF NOT EXISTS "configuration_type" "dian_configuration_type_enum" NOT NULL DEFAULT 'invoicing';

-- CreateTable: payroll_settlements
CREATE TABLE IF NOT EXISTS "payroll_settlements" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "employee_id" INTEGER NOT NULL,
    "settlement_number" VARCHAR(50) NOT NULL,
    "status" "settlement_status_enum" NOT NULL DEFAULT 'draft',
    "termination_date" TIMESTAMP(6) NOT NULL,
    "termination_reason" "termination_reason_enum" NOT NULL,
    "hire_date" TIMESTAMP(6) NOT NULL,
    "days_worked" INTEGER NOT NULL,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "contract_type" "contract_type_enum" NOT NULL,
    "severance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "severance_interest" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vacation" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pending_salary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "indemnification" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "health_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pension_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gross_settlement" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_settlement" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "calculation_detail" JSONB,
    "document_url" TEXT,
    "accounting_entry_id" INTEGER,
    "approved_by_user_id" INTEGER,
    "approved_at" TIMESTAMP(6),
    "created_by_user_id" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable: employee_advances
CREATE TABLE IF NOT EXISTS "employee_advances" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "advance_number" VARCHAR(50) NOT NULL,
    "amount_requested" DECIMAL(12,2) NOT NULL,
    "amount_approved" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount_pending" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "installment_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "frequency" "payroll_frequency_enum" NOT NULL DEFAULT 'monthly',
    "status" "employee_advance_status_enum" NOT NULL DEFAULT 'pending',
    "advance_date" TIMESTAMP(6) NOT NULL,
    "reason" VARCHAR(500),
    "approved_by_user_id" INTEGER,
    "approved_at" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6),
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable: employee_advance_payments
CREATE TABLE IF NOT EXISTS "employee_advance_payments" (
    "id" SERIAL NOT NULL,
    "advance_id" INTEGER NOT NULL,
    "payroll_item_id" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMP(6) NOT NULL,
    "payment_type" VARCHAR(30) NOT NULL DEFAULT 'payroll_deduction',
    "notes" VARCHAR(255),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_advance_payments_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_settlements_organization_id_settlement_number_key" ON "payroll_settlements"("organization_id", "settlement_number");
CREATE UNIQUE INDEX IF NOT EXISTS "employee_advances_organization_id_advance_number_key" ON "employee_advances"("organization_id", "advance_number");

-- Indexes: payroll_settlements
CREATE INDEX IF NOT EXISTS "payroll_settlements_organization_id_status_idx" ON "payroll_settlements"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "payroll_settlements_employee_id_idx" ON "payroll_settlements"("employee_id");
CREATE INDEX IF NOT EXISTS "payroll_settlements_store_id_idx" ON "payroll_settlements"("store_id");

-- Indexes: employee_advances
CREATE INDEX IF NOT EXISTS "employee_advances_organization_id_status_idx" ON "employee_advances"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "employee_advances_employee_id_status_idx" ON "employee_advances"("employee_id", "status");

-- Indexes: employee_advance_payments
CREATE INDEX IF NOT EXISTS "employee_advance_payments_advance_id_idx" ON "employee_advance_payments"("advance_id");
CREATE INDEX IF NOT EXISTS "employee_advance_payments_payroll_item_id_idx" ON "employee_advance_payments"("payroll_item_id");

-- Foreign Keys: payroll_settlements
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_accounting_entry_id_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Foreign Keys: employee_advances
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Foreign Keys: employee_advance_payments
ALTER TABLE "employee_advance_payments" ADD CONSTRAINT "employee_advance_payments_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "employee_advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_advance_payments" ADD CONSTRAINT "employee_advance_payments_payroll_item_id_fkey" FOREIGN KEY ("payroll_item_id") REFERENCES "payroll_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

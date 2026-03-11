-- CreateEnum (idempotent)
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status_enum') THEN CREATE TYPE "invoice_status_enum" AS ENUM ('draft', 'validated', 'sent', 'accepted', 'rejected', 'cancelled', 'voided'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_type_enum') THEN CREATE TYPE "invoice_type_enum" AS ENUM ('sales_invoice', 'purchase_invoice', 'credit_note', 'debit_note', 'export_invoice'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_send_status_enum') THEN CREATE TYPE "document_send_status_enum" AS ENUM ('pending', 'sending', 'sent_ok', 'sent_error', 'not_applicable'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'accounting_entry_status_enum') THEN CREATE TYPE "accounting_entry_status_enum" AS ENUM ('draft', 'posted', 'voided'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'accounting_entry_type_enum') THEN CREATE TYPE "accounting_entry_type_enum" AS ENUM ('manual', 'auto_invoice', 'auto_payment', 'auto_expense', 'auto_payroll', 'auto_inventory', 'adjustment'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type_enum') THEN CREATE TYPE "account_type_enum" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_nature_enum') THEN CREATE TYPE "account_nature_enum" AS ENUM ('debit', 'credit'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_period_status_enum') THEN CREATE TYPE "fiscal_period_status_enum" AS ENUM ('open', 'closing', 'closed'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_status_enum') THEN CREATE TYPE "payroll_status_enum" AS ENUM ('draft', 'calculated', 'approved', 'sent', 'accepted', 'rejected', 'paid', 'cancelled'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_frequency_enum') THEN CREATE TYPE "payroll_frequency_enum" AS ENUM ('monthly', 'biweekly', 'weekly'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employee_status_enum') THEN CREATE TYPE "employee_status_enum" AS ENUM ('active', 'inactive', 'terminated'); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_type_enum') THEN CREATE TYPE "contract_type_enum" AS ENUM ('indefinite', 'fixed_term', 'service', 'apprentice'); END IF; END $$;

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL,
    "invoice_type" "invoice_type_enum" NOT NULL,
    "status" "invoice_status_enum" NOT NULL DEFAULT 'draft',
    "customer_id" INTEGER,
    "supplier_id" INTEGER,
    "customer_name" VARCHAR(255),
    "customer_tax_id" VARCHAR(50),
    "customer_address" JSONB,
    "order_id" INTEGER,
    "sales_order_id" INTEGER,
    "related_invoice_id" INTEGER,
    "subtotal_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "withholding_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10),
    "exchange_rate" DECIMAL(12,6),
    "resolution_id" INTEGER,
    "cufe" VARCHAR(255),
    "qr_code" TEXT,
    "xml_document" TEXT,
    "pdf_url" TEXT,
    "send_status" "document_send_status_enum" NOT NULL DEFAULT 'not_applicable',
    "provider_response" JSONB,
    "sent_at" TIMESTAMP(6),
    "accepted_at" TIMESTAMP(6),
    "issue_date" TIMESTAMP(6) NOT NULL,
    "due_date" TIMESTAMP(6),
    "payment_date" TIMESTAMP(6),
    "accounting_entry_id" INTEGER,
    "created_by_user_id" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "product_id" INTEGER,
    "product_variant_id" INTEGER,
    "description" VARCHAR(500) NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_taxes" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "tax_rate_id" INTEGER,
    "tax_name" VARCHAR(100) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "taxable_amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_resolutions" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "resolution_number" VARCHAR(100) NOT NULL,
    "resolution_date" TIMESTAMP(6) NOT NULL,
    "prefix" VARCHAR(10) NOT NULL,
    "range_from" INTEGER NOT NULL,
    "range_to" INTEGER NOT NULL,
    "current_number" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMP(6) NOT NULL,
    "valid_to" TIMESTAMP(6) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "technical_key" VARCHAR(255),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "account_type" "account_type_enum" NOT NULL,
    "nature" "account_nature_enum" NOT NULL,
    "parent_id" INTEGER,
    "level" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "accepts_entries" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "start_date" TIMESTAMP(6) NOT NULL,
    "end_date" TIMESTAMP(6) NOT NULL,
    "status" "fiscal_period_status_enum" NOT NULL DEFAULT 'open',
    "closed_by_user_id" INTEGER,
    "closed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_entries" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "entry_number" VARCHAR(50) NOT NULL,
    "entry_type" "accounting_entry_type_enum" NOT NULL DEFAULT 'manual',
    "status" "accounting_entry_status_enum" NOT NULL DEFAULT 'draft',
    "fiscal_period_id" INTEGER NOT NULL,
    "entry_date" TIMESTAMP(6) NOT NULL,
    "description" VARCHAR(500),
    "source_type" VARCHAR(50),
    "source_id" INTEGER,
    "total_debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_by_user_id" INTEGER,
    "posted_by_user_id" INTEGER,
    "posted_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_entry_lines" (
    "id" SERIAL NOT NULL,
    "entry_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "description" VARCHAR(500),
    "debit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "user_id" INTEGER,
    "employee_code" VARCHAR(50) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "document_type" VARCHAR(20) NOT NULL,
    "document_number" VARCHAR(50) NOT NULL,
    "hire_date" TIMESTAMP(6) NOT NULL,
    "termination_date" TIMESTAMP(6),
    "status" "employee_status_enum" NOT NULL DEFAULT 'active',
    "contract_type" "contract_type_enum" NOT NULL,
    "position" VARCHAR(100),
    "department" VARCHAR(100),
    "base_salary" DECIMAL(12,2) NOT NULL,
    "payment_frequency" "payroll_frequency_enum" NOT NULL DEFAULT 'monthly',
    "bank_name" VARCHAR(100),
    "bank_account_number" VARCHAR(50),
    "bank_account_type" VARCHAR(20),
    "health_provider" VARCHAR(100),
    "pension_fund" VARCHAR(100),
    "arl_risk_level" INTEGER DEFAULT 1,
    "severance_fund" VARCHAR(100),
    "compensation_fund" VARCHAR(100),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "payroll_number" VARCHAR(50) NOT NULL,
    "status" "payroll_status_enum" NOT NULL DEFAULT 'draft',
    "frequency" "payroll_frequency_enum" NOT NULL,
    "period_start" TIMESTAMP(6) NOT NULL,
    "period_end" TIMESTAMP(6) NOT NULL,
    "payment_date" TIMESTAMP(6),
    "total_earnings" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_employer_costs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_net_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "send_status" "document_send_status_enum" NOT NULL DEFAULT 'not_applicable',
    "provider_response" JSONB,
    "cune" VARCHAR(255),
    "xml_document" TEXT,
    "sent_at" TIMESTAMP(6),
    "accounting_entry_id" INTEGER,
    "approved_by_user_id" INTEGER,
    "approved_at" TIMESTAMP(6),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" SERIAL NOT NULL,
    "payroll_run_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "worked_days" INTEGER NOT NULL,
    "earnings" JSONB,
    "deductions" JSONB,
    "employer_costs" JSONB,
    "total_earnings" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_employer_costs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_store_id_status_idx" ON "invoices"("store_id", "status");

-- CreateIndex
CREATE INDEX "invoices_organization_id_issue_date_idx" ON "invoices"("organization_id", "issue_date");

-- CreateIndex
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_invoice_type_invoice_number_key" ON "invoices"("organization_id", "invoice_type", "invoice_number");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_taxes_invoice_id_idx" ON "invoice_taxes"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_resolutions_store_id_is_active_idx" ON "invoice_resolutions"("store_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_resolutions_organization_id_store_id_prefix_key" ON "invoice_resolutions"("organization_id", "store_id", "prefix");

-- CreateIndex
CREATE INDEX "chart_of_accounts_organization_id_parent_id_idx" ON "chart_of_accounts"("organization_id", "parent_id");

-- CreateIndex
CREATE INDEX "chart_of_accounts_organization_id_account_type_idx" ON "chart_of_accounts"("organization_id", "account_type");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_organization_id_code_key" ON "chart_of_accounts"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_organization_id_name_key" ON "fiscal_periods"("organization_id", "name");

-- CreateIndex
CREATE INDEX "accounting_entries_organization_id_entry_date_idx" ON "accounting_entries"("organization_id", "entry_date");

-- CreateIndex
CREATE INDEX "accounting_entries_organization_id_fiscal_period_id_idx" ON "accounting_entries"("organization_id", "fiscal_period_id");

-- CreateIndex
CREATE INDEX "accounting_entries_source_type_source_id_idx" ON "accounting_entries"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entries_organization_id_entry_number_key" ON "accounting_entries"("organization_id", "entry_number");

-- CreateIndex
CREATE INDEX "accounting_entry_lines_entry_id_idx" ON "accounting_entry_lines"("entry_id");

-- CreateIndex
CREATE INDEX "accounting_entry_lines_account_id_idx" ON "accounting_entry_lines"("account_id");

-- CreateIndex
CREATE INDEX "employees_organization_id_status_idx" ON "employees"("organization_id", "status");

-- CreateIndex
CREATE INDEX "employees_store_id_idx" ON "employees"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_employee_code_key" ON "employees"("organization_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_document_type_document_number_key" ON "employees"("organization_id", "document_type", "document_number");

-- CreateIndex
CREATE INDEX "payroll_runs_organization_id_status_idx" ON "payroll_runs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "payroll_runs_store_id_idx" ON "payroll_runs"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_organization_id_payroll_number_key" ON "payroll_runs"("organization_id", "payroll_number");

-- CreateIndex
CREATE INDEX "payroll_items_payroll_run_id_idx" ON "payroll_items"("payroll_run_id");

-- CreateIndex
CREATE INDEX "payroll_items_employee_id_idx" ON "payroll_items"("employee_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_related_invoice_id_fkey" FOREIGN KEY ("related_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "invoice_resolutions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_accounting_entry_id_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoice_taxes" ADD CONSTRAINT "invoice_taxes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_taxes" ADD CONSTRAINT "invoice_taxes_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoice_resolutions" ADD CONSTRAINT "invoice_resolutions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_resolutions" ADD CONSTRAINT "invoice_resolutions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "accounting_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_accounting_entry_id_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

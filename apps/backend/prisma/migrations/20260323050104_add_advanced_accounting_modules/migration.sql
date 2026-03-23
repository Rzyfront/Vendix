-- CreateEnum
CREATE TYPE "bank_transaction_type_enum" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "bank_reconciliation_status_enum" AS ENUM ('draft', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "bank_reconciliation_match_type_enum" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "bank_account_status_enum" AS ENUM ('active', 'inactive', 'closed');

-- CreateEnum
CREATE TYPE "depreciation_method_enum" AS ENUM ('straight_line', 'declining_balance');

-- CreateEnum
CREATE TYPE "fixed_asset_status_enum" AS ENUM ('active', 'fully_depreciated', 'retired', 'disposed');

-- CreateEnum
CREATE TYPE "depreciation_entry_status_enum" AS ENUM ('pending', 'posted');

-- CreateEnum
CREATE TYPE "budget_status_enum" AS ENUM ('draft', 'approved', 'active', 'closed');

-- CreateEnum
CREATE TYPE "consolidation_status_enum" AS ENUM ('draft', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "consolidation_adjustment_type_enum" AS ENUM ('elimination', 'reclassification', 'adjustment');

-- AlterEnum (idempotent for production safety)
ALTER TYPE "accounting_entry_type_enum" ADD VALUE IF NOT EXISTS 'auto_depreciation';

-- AlterTable
ALTER TABLE "chart_of_accounts" ADD COLUMN     "is_intercompany" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "name" VARCHAR(100) NOT NULL,
    "account_number" VARCHAR(50) NOT NULL,
    "bank_name" VARCHAR(100) NOT NULL,
    "bank_code" VARCHAR(20),
    "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
    "opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "current_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "bank_account_status_enum" NOT NULL DEFAULT 'active',
    "chart_account_id" INTEGER,
    "column_mapping" JSONB,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" SERIAL NOT NULL,
    "bank_account_id" INTEGER NOT NULL,
    "transaction_date" DATE NOT NULL,
    "value_date" DATE,
    "description" VARCHAR(500) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" "bank_transaction_type_enum" NOT NULL,
    "reference" VARCHAR(255),
    "external_id" VARCHAR(255),
    "counterparty" VARCHAR(255),
    "is_reconciled" BOOLEAN NOT NULL DEFAULT false,
    "imported_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" SERIAL NOT NULL,
    "bank_account_id" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "opening_balance" DECIMAL(12,2) NOT NULL,
    "statement_balance" DECIMAL(12,2) NOT NULL,
    "reconciled_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "bank_reconciliation_status_enum" NOT NULL DEFAULT 'draft',
    "completed_at" TIMESTAMP(6),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliation_matches" (
    "id" SERIAL NOT NULL,
    "reconciliation_id" INTEGER NOT NULL,
    "bank_transaction_id" INTEGER NOT NULL,
    "accounting_entry_id" INTEGER,
    "match_type" "bank_reconciliation_match_type_enum" NOT NULL,
    "confidence_score" DECIMAL(5,2),
    "notes" VARCHAR(500),
    "matched_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "matched_by_user_id" INTEGER,

    CONSTRAINT "bank_reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_categories" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "default_useful_life_months" INTEGER NOT NULL DEFAULT 60,
    "default_depreciation_method" "depreciation_method_enum" NOT NULL DEFAULT 'straight_line',
    "default_salvage_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "depreciation_account_code" VARCHAR(20),
    "expense_account_code" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "category_id" INTEGER,
    "asset_number" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(500),
    "acquisition_date" DATE NOT NULL,
    "acquisition_cost" DECIMAL(12,2) NOT NULL,
    "salvage_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER NOT NULL,
    "depreciation_method" "depreciation_method_enum" NOT NULL DEFAULT 'straight_line',
    "status" "fixed_asset_status_enum" NOT NULL DEFAULT 'active',
    "accumulated_depreciation" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "depreciation_start_date" DATE,
    "retirement_date" DATE,
    "disposal_date" DATE,
    "disposal_amount" DECIMAL(12,2),
    "notes" VARCHAR(1000),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_entries" (
    "id" SERIAL NOT NULL,
    "fixed_asset_id" INTEGER NOT NULL,
    "period_date" DATE NOT NULL,
    "depreciation_amount" DECIMAL(12,2) NOT NULL,
    "accumulated_total" DECIMAL(12,2) NOT NULL,
    "book_value" DECIMAL(12,2) NOT NULL,
    "accounting_entry_id" INTEGER,
    "status" "depreciation_entry_status_enum" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "fiscal_period_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(500),
    "status" "budget_status_enum" NOT NULL DEFAULT 'draft',
    "variance_threshold" DECIMAL(5,2) DEFAULT 10,
    "approved_by_user_id" INTEGER,
    "approved_at" TIMESTAMP(6),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" SERIAL NOT NULL,
    "budget_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "month_01" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_02" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_03" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_04" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_05" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_06" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_07" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_08" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_09" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_10" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_11" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "month_12" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_budgeted" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_sessions" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "fiscal_period_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "session_date" TIMESTAMP(6) NOT NULL,
    "status" "consolidation_status_enum" NOT NULL DEFAULT 'draft',
    "notes" VARCHAR(1000),
    "created_by_user_id" INTEGER,
    "completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intercompany_transactions" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "from_store_id" INTEGER NOT NULL,
    "to_store_id" INTEGER NOT NULL,
    "entry_id" INTEGER NOT NULL,
    "counterpart_entry_id" INTEGER,
    "account_id" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "eliminated" BOOLEAN NOT NULL DEFAULT false,
    "eliminated_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intercompany_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_adjustments" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "type" "consolidation_adjustment_type_enum" NOT NULL,
    "debit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" VARCHAR(500) NOT NULL,
    "store_id" INTEGER,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_organization_id_store_id_idx" ON "bank_accounts"("organization_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_organization_id_account_number_key" ON "bank_accounts"("organization_id", "account_number");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_account_id_transaction_date_idx" ON "bank_transactions"("bank_account_id", "transaction_date");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_account_id_is_reconciled_idx" ON "bank_transactions"("bank_account_id", "is_reconciled");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bank_account_id_external_id_key" ON "bank_transactions"("bank_account_id", "external_id");

-- CreateIndex
CREATE INDEX "bank_reconciliations_bank_account_id_period_start_idx" ON "bank_reconciliations"("bank_account_id", "period_start");

-- CreateIndex
CREATE INDEX "bank_reconciliation_matches_reconciliation_id_idx" ON "bank_reconciliation_matches"("reconciliation_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliation_matches_reconciliation_id_bank_transact_key" ON "bank_reconciliation_matches"("reconciliation_id", "bank_transaction_id");

-- CreateIndex
CREATE INDEX "fixed_asset_categories_organization_id_idx" ON "fixed_asset_categories"("organization_id");

-- CreateIndex
CREATE INDEX "fixed_assets_organization_id_store_id_idx" ON "fixed_assets"("organization_id", "store_id");

-- CreateIndex
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_organization_id_asset_number_key" ON "fixed_assets"("organization_id", "asset_number");

-- CreateIndex
CREATE INDEX "depreciation_entries_status_idx" ON "depreciation_entries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_entries_fixed_asset_id_period_date_key" ON "depreciation_entries"("fixed_asset_id", "period_date");

-- CreateIndex
CREATE INDEX "budgets_organization_id_fiscal_period_id_idx" ON "budgets"("organization_id", "fiscal_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_organization_id_store_id_fiscal_period_id_name_key" ON "budgets"("organization_id", "store_id", "fiscal_period_id", "name");

-- CreateIndex
CREATE INDEX "budget_lines_budget_id_idx" ON "budget_lines"("budget_id");

-- CreateIndex
CREATE INDEX "budget_lines_account_id_idx" ON "budget_lines"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_budget_id_account_id_key" ON "budget_lines"("budget_id", "account_id");

-- CreateIndex
CREATE INDEX "consolidation_sessions_organization_id_fiscal_period_id_idx" ON "consolidation_sessions"("organization_id", "fiscal_period_id");

-- CreateIndex
CREATE INDEX "intercompany_transactions_session_id_idx" ON "intercompany_transactions"("session_id");

-- CreateIndex
CREATE INDEX "intercompany_transactions_organization_id_from_store_id_to__idx" ON "intercompany_transactions"("organization_id", "from_store_id", "to_store_id");

-- CreateIndex
CREATE INDEX "consolidation_adjustments_session_id_idx" ON "consolidation_adjustments"("session_id");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_chart_account_id_fkey" FOREIGN KEY ("chart_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "bank_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_accounting_entry_id_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_matched_by_user_id_fkey" FOREIGN KEY ("matched_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fixed_asset_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_fixed_asset_id_fkey" FOREIGN KEY ("fixed_asset_id") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_accounting_entry_id_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consolidation_sessions" ADD CONSTRAINT "consolidation_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_sessions" ADD CONSTRAINT "consolidation_sessions_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consolidation_sessions" ADD CONSTRAINT "consolidation_sessions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "consolidation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_from_store_id_fkey" FOREIGN KEY ("from_store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_to_store_id_fkey" FOREIGN KEY ("to_store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_counterpart_entry_id_fkey" FOREIGN KEY ("counterpart_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consolidation_adjustments" ADD CONSTRAINT "consolidation_adjustments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "consolidation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_adjustments" ADD CONSTRAINT "consolidation_adjustments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consolidation_adjustments" ADD CONSTRAINT "consolidation_adjustments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consolidation_adjustments" ADD CONSTRAINT "consolidation_adjustments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

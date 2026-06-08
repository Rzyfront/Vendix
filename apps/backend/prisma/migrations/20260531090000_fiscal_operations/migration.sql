-- DATA IMPACT:
-- Tables affected: fiscal_obligations, tax_declaration_drafts, tax_declaration_lines,
-- fiscal_close_sessions, fiscal_close_checks, fiscal_rule_sets
-- Expected row changes: schema-only migration, no existing row updates
-- Destructive operations: none
-- FK/cascade risk: new child tables reference existing tenant/fiscal tables
-- Idempotency: guarded enum creation, ALTER TYPE IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_obligation_type_enum') THEN
    CREATE TYPE "fiscal_obligation_type_enum" AS ENUM (
      'vat_return',
      'withholding_return',
      'reteiva_return',
      'reteica_return',
      'ica_return',
      'exogenous_report',
      'income_tax_precierre',
      'electronic_invoice_review',
      'support_document_review',
      'payroll_electronic_review',
      'bank_reconciliation',
      'inventory_valuation',
      'monthly_close',
      'annual_close'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_obligation_status_enum') THEN
    CREATE TYPE "fiscal_obligation_status_enum" AS ENUM (
      'pending',
      'in_progress',
      'blocked',
      'ready',
      'approved',
      'submitted',
      'accepted',
      'rejected',
      'paid',
      'overdue',
      'cancelled',
      'not_applicable'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tax_declaration_type_enum') THEN
    CREATE TYPE "tax_declaration_type_enum" AS ENUM (
      'vat',
      'withholding',
      'reteiva',
      'reteica',
      'ica',
      'exogenous',
      'income_tax_precierre'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tax_declaration_status_enum') THEN
    CREATE TYPE "tax_declaration_status_enum" AS ENUM (
      'draft',
      'calculating',
      'ready',
      'needs_review',
      'approved',
      'submitted',
      'accepted',
      'rejected',
      'paid',
      'voided'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_close_status_enum') THEN
    CREATE TYPE "fiscal_close_status_enum" AS ENUM (
      'draft',
      'checking',
      'blocked',
      'ready',
      'approved',
      'closed',
      'reopened',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_close_check_status_enum') THEN
    CREATE TYPE "fiscal_close_check_status_enum" AS ENUM (
      'pending',
      'passed',
      'failed',
      'warning',
      'not_applicable',
      'manually_overridden'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_rule_status_enum') THEN
    CREATE TYPE "fiscal_rule_status_enum" AS ENUM (
      'draft',
      'active',
      'deprecated',
      'archived'
    );
  END IF;
END $$;

ALTER TYPE "fiscal_evidence_type_enum" ADD VALUE IF NOT EXISTS 'payment_receipt';
ALTER TYPE "fiscal_evidence_type_enum" ADD VALUE IF NOT EXISTS 'bank_receipt';
ALTER TYPE "fiscal_evidence_type_enum" ADD VALUE IF NOT EXISTS 'declaration_pdf';
ALTER TYPE "fiscal_evidence_type_enum" ADD VALUE IF NOT EXISTS 'declaration_excel';
ALTER TYPE "fiscal_evidence_type_enum" ADD VALUE IF NOT EXISTS 'exogenous_txt';
ALTER TYPE "fiscal_evidence_type_enum" ADD VALUE IF NOT EXISTS 'manual_support';
ALTER TYPE "fiscal_evidence_type_enum" ADD VALUE IF NOT EXISTS 'approval_record';

CREATE TABLE IF NOT EXISTS "fiscal_obligations" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER NOT NULL,
  "type" "fiscal_obligation_type_enum" NOT NULL,
  "status" "fiscal_obligation_status_enum" NOT NULL DEFAULT 'pending',
  "period_year" INTEGER NOT NULL,
  "period_month" INTEGER,
  "period_quarter" INTEGER,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "due_date" DATE NOT NULL,
  "estimated_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "final_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
  "source" VARCHAR(50) NOT NULL DEFAULT 'manual',
  "source_ref" VARCHAR(120),
  "blocking_reason" TEXT,
  "notes" TEXT,
  "assigned_to_user_id" INTEGER,
  "approved_by_user_id" INTEGER,
  "approved_at" TIMESTAMP(6),
  "submitted_at" TIMESTAMP(6),
  "accepted_at" TIMESTAMP(6),
  "paid_at" TIMESTAMP(6),
  "evidence_id" INTEGER,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_obligations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_obligations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_obligations_accounting_entity_id_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_obligations_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_obligations_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_obligations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_obligations_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "fiscal_evidences"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_obligations_period_month_chk" CHECK ("period_month" IS NULL OR ("period_month" >= 1 AND "period_month" <= 12)),
  CONSTRAINT "fiscal_obligations_period_quarter_chk" CHECK ("period_quarter" IS NULL OR ("period_quarter" >= 1 AND "period_quarter" <= 4))
);

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_obligations_entity_type_period_key"
  ON "fiscal_obligations"("accounting_entity_id", "type", "period_year", "period_month", "period_quarter");
CREATE INDEX IF NOT EXISTS "fiscal_obligations_org_entity_type_year_idx"
  ON "fiscal_obligations"("organization_id", "accounting_entity_id", "type", "period_year");
CREATE INDEX IF NOT EXISTS "fiscal_obligations_entity_status_due_idx"
  ON "fiscal_obligations"("accounting_entity_id", "status", "due_date");
CREATE INDEX IF NOT EXISTS "fiscal_obligations_store_status_idx"
  ON "fiscal_obligations"("store_id", "status");
CREATE INDEX IF NOT EXISTS "fiscal_obligations_type_due_idx"
  ON "fiscal_obligations"("type", "due_date");

CREATE TABLE IF NOT EXISTS "tax_declaration_drafts" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER NOT NULL,
  "obligation_id" INTEGER,
  "declaration_type" "tax_declaration_type_enum" NOT NULL,
  "status" "tax_declaration_status_enum" NOT NULL DEFAULT 'draft',
  "period_year" INTEGER NOT NULL,
  "period_month" INTEGER,
  "period_quarter" INTEGER,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
  "gross_base_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "taxable_base_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "exempt_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "excluded_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "generated_tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "deductible_tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "withholding_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "balance_due" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "balance_favor" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "penalties_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "interest_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "total_payable" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "rules_snapshot" JSONB,
  "source_snapshot" JSONB,
  "validation_summary" JSONB,
  "approved_by_user_id" INTEGER,
  "approved_at" TIMESTAMP(6),
  "submitted_at" TIMESTAMP(6),
  "accepted_at" TIMESTAMP(6),
  "paid_at" TIMESTAMP(6),
  "evidence_id" INTEGER,
  "notes" TEXT,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_declaration_drafts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_declaration_drafts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_declaration_drafts_accounting_entity_id_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_declaration_drafts_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "fiscal_obligations"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "tax_declaration_drafts_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "fiscal_evidences"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "tax_declaration_drafts_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "tax_declaration_drafts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "tax_declaration_drafts_entity_type_year_idx"
  ON "tax_declaration_drafts"("accounting_entity_id", "declaration_type", "period_year");
CREATE INDEX IF NOT EXISTS "tax_declaration_drafts_obligation_idx"
  ON "tax_declaration_drafts"("obligation_id");
CREATE INDEX IF NOT EXISTS "tax_declaration_drafts_status_period_end_idx"
  ON "tax_declaration_drafts"("status", "period_end");

CREATE TABLE IF NOT EXISTS "tax_declaration_lines" (
  "id" SERIAL PRIMARY KEY,
  "declaration_id" INTEGER NOT NULL,
  "line_type" VARCHAR(60) NOT NULL,
  "source_type" VARCHAR(60) NOT NULL,
  "source_id" INTEGER,
  "third_party_id" INTEGER,
  "third_party_name" VARCHAR(255),
  "third_party_tax_id" VARCHAR(50),
  "account_id" INTEGER,
  "tax_rate_id" INTEGER,
  "concept_code" VARCHAR(50),
  "description" VARCHAR(500) NOT NULL,
  "base_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "withholding_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "debit_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "credit_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_declaration_lines_declaration_id_fkey" FOREIGN KEY ("declaration_id") REFERENCES "tax_declaration_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tax_declaration_lines_declaration_idx"
  ON "tax_declaration_lines"("declaration_id");
CREATE INDEX IF NOT EXISTS "tax_declaration_lines_source_idx"
  ON "tax_declaration_lines"("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "tax_declaration_lines_third_party_tax_id_idx"
  ON "tax_declaration_lines"("third_party_tax_id");

CREATE TABLE IF NOT EXISTS "fiscal_close_sessions" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER NOT NULL,
  "fiscal_period_id" INTEGER,
  "status" "fiscal_close_status_enum" NOT NULL DEFAULT 'draft',
  "close_type" VARCHAR(30) NOT NULL DEFAULT 'monthly',
  "period_year" INTEGER NOT NULL,
  "period_month" INTEGER,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "started_by_user_id" INTEGER NOT NULL,
  "approved_by_user_id" INTEGER,
  "closed_by_user_id" INTEGER,
  "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(6),
  "closed_at" TIMESTAMP(6),
  "reopened_at" TIMESTAMP(6),
  "reopen_reason" TEXT,
  "summary" JSONB,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_close_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_close_sessions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_close_sessions_accounting_entity_id_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_close_sessions_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_close_sessions_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_close_sessions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_close_sessions_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_close_sessions_entity_type_period_key"
  ON "fiscal_close_sessions"("accounting_entity_id", "close_type", "period_year", "period_month");
CREATE INDEX IF NOT EXISTS "fiscal_close_sessions_org_entity_year_idx"
  ON "fiscal_close_sessions"("organization_id", "accounting_entity_id", "period_year");
CREATE INDEX IF NOT EXISTS "fiscal_close_sessions_entity_status_period_idx"
  ON "fiscal_close_sessions"("accounting_entity_id", "status", "period_end");
CREATE INDEX IF NOT EXISTS "fiscal_close_sessions_store_status_idx"
  ON "fiscal_close_sessions"("store_id", "status");

CREATE TABLE IF NOT EXISTS "fiscal_close_checks" (
  "id" SERIAL PRIMARY KEY,
  "close_session_id" INTEGER NOT NULL,
  "check_key" VARCHAR(80) NOT NULL,
  "status" "fiscal_close_check_status_enum" NOT NULL DEFAULT 'pending',
  "severity" VARCHAR(20) NOT NULL DEFAULT 'blocking',
  "title" VARCHAR(180) NOT NULL,
  "description" TEXT,
  "result_summary" TEXT,
  "blocking" BOOLEAN NOT NULL DEFAULT TRUE,
  "source_type" VARCHAR(60),
  "source_id" INTEGER,
  "resolved_by_user_id" INTEGER,
  "resolved_at" TIMESTAMP(6),
  "override_reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_close_checks_close_session_id_fkey" FOREIGN KEY ("close_session_id") REFERENCES "fiscal_close_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fiscal_close_checks_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_close_checks_session_key"
  ON "fiscal_close_checks"("close_session_id", "check_key");
CREATE INDEX IF NOT EXISTS "fiscal_close_checks_session_status_idx"
  ON "fiscal_close_checks"("close_session_id", "status");
CREATE INDEX IF NOT EXISTS "fiscal_close_checks_source_idx"
  ON "fiscal_close_checks"("source_type", "source_id");

CREATE TABLE IF NOT EXISTS "fiscal_rule_sets" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER,
  "accounting_entity_id" INTEGER,
  "country_code" VARCHAR(3) NOT NULL DEFAULT 'CO',
  "year" INTEGER NOT NULL,
  "rule_type" VARCHAR(50) NOT NULL,
  "status" "fiscal_rule_status_enum" NOT NULL DEFAULT 'draft',
  "name" VARCHAR(150) NOT NULL,
  "version" VARCHAR(40) NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "rules" JSONB NOT NULL,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_rule_sets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_rule_sets_accounting_entity_id_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_rule_sets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_rule_sets_scope_year_type_version_key"
  ON "fiscal_rule_sets"("organization_id", "accounting_entity_id", "country_code", "year", "rule_type", "version");
CREATE INDEX IF NOT EXISTS "fiscal_rule_sets_country_year_type_status_idx"
  ON "fiscal_rule_sets"("country_code", "year", "rule_type", "status");
CREATE INDEX IF NOT EXISTS "fiscal_rule_sets_scope_idx"
  ON "fiscal_rule_sets"("organization_id", "accounting_entity_id");

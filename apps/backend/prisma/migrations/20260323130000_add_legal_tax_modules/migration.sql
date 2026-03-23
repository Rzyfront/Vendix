-- ══════════════════════════════════════════════════════════
-- Migration: add_legal_tax_modules
-- Modules: Retención en Fuente, Información Exógena DIAN,
--          HABEAS DATA, ICA por Municipio
-- ══════════════════════════════════════════════════════════

-- ── Enums (idempotent) ────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withholding_applies_to_enum') THEN
    CREATE TYPE "withholding_applies_to_enum" AS ENUM ('purchase', 'service', 'rent', 'fees', 'other');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withholding_supplier_type_enum') THEN
    CREATE TYPE "withholding_supplier_type_enum" AS ENUM ('gran_contribuyente', 'regimen_simple', 'persona_natural', 'any');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exogenous_report_status_enum') THEN
    CREATE TYPE "exogenous_report_status_enum" AS ENUM ('draft', 'generating', 'generated', 'validated', 'submitted', 'rejected');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_type_enum') THEN
    CREATE TYPE "consent_type_enum" AS ENUM ('marketing', 'analytics', 'third_party', 'profiling');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_export_status_enum') THEN
    CREATE TYPE "data_export_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'anonymization_status_enum') THEN
    CREATE TYPE "anonymization_status_enum" AS ENUM ('pending', 'approved', 'executed', 'rejected');
  END IF;
END
$$;

-- ── Alter existing tables ─────────────────────────────────

ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "municipality_code" VARCHAR(10);

ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "tax_regime" VARCHAR(50);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "document_type" VARCHAR(10);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "verification_digit" VARCHAR(1);

-- ── Retención en Fuente ───────────────────────────────────

CREATE TABLE IF NOT EXISTS "uvt_values" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "value_cop" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uvt_values_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "withholding_concepts" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "min_uvt_threshold" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "applies_to" "withholding_applies_to_enum" NOT NULL,
    "supplier_type_filter" "withholding_supplier_type_enum" NOT NULL DEFAULT 'any',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "withholding_concepts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "withholding_calculations" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "invoice_id" INTEGER,
    "supplier_id" INTEGER,
    "concept_id" INTEGER NOT NULL,
    "base_amount" DECIMAL(12,2) NOT NULL,
    "withholding_rate" DECIMAL(7,4) NOT NULL,
    "withholding_amount" DECIMAL(12,2) NOT NULL,
    "uvt_value_used" DECIMAL(12,2) NOT NULL,
    "year" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "withholding_calculations_pkey" PRIMARY KEY ("id")
);

-- ── Información Exógena DIAN ──────────────────────────────

CREATE TABLE IF NOT EXISTS "exogenous_reports" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "fiscal_year" INTEGER NOT NULL,
    "format_code" VARCHAR(10) NOT NULL,
    "status" "exogenous_report_status_enum" NOT NULL DEFAULT 'draft',
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "file_key" TEXT,
    "validation_errors" JSONB,
    "generated_at" TIMESTAMP(6),
    "submitted_at" TIMESTAMP(6),
    "submission_response" JSONB,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exogenous_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "exogenous_report_lines" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "third_party_nit" VARCHAR(20) NOT NULL,
    "third_party_name" VARCHAR(255) NOT NULL,
    "third_party_dv" VARCHAR(1),
    "concept_code" VARCHAR(10) NOT NULL,
    "payment_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "withholding_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "line_data" JSONB,
    CONSTRAINT "exogenous_report_lines_pkey" PRIMARY KEY ("id")
);

-- ── HABEAS DATA ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "user_consents" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "consent_type" "consent_type_enum" NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "granted_at" TIMESTAMP(6),
    "revoked_at" TIMESTAMP(6),
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "data_export_requests" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" "data_export_status_enum" NOT NULL DEFAULT 'pending',
    "file_key" TEXT,
    "file_expires_at" TIMESTAMP(6),
    "requested_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(6),
    "error_message" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "anonymization_requests" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "requested_by_user_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "anonymization_status_enum" NOT NULL DEFAULT 'pending',
    "anonymized_at" TIMESTAMP(6),
    "original_data_hash" VARCHAR(64),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "anonymization_requests_pkey" PRIMARY KEY ("id")
);

-- ── ICA por Municipio ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ica_municipal_rates" (
    "id" SERIAL NOT NULL,
    "municipality_code" VARCHAR(10) NOT NULL,
    "municipality_name" VARCHAR(100) NOT NULL,
    "department_code" VARCHAR(5) NOT NULL,
    "department_name" VARCHAR(100) NOT NULL,
    "ciiu_code" VARCHAR(10),
    "ciiu_description" VARCHAR(255),
    "rate_per_mil" DECIMAL(8,4) NOT NULL,
    "effective_date" TIMESTAMP(6) NOT NULL,
    "end_date" TIMESTAMP(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ica_municipal_rates_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ───────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "uvt_values_organization_id_year_key" ON "uvt_values"("organization_id", "year");
CREATE INDEX IF NOT EXISTS "uvt_values_organization_id_idx" ON "uvt_values"("organization_id");

CREATE UNIQUE INDEX IF NOT EXISTS "withholding_concepts_organization_id_code_key" ON "withholding_concepts"("organization_id", "code");
CREATE INDEX IF NOT EXISTS "withholding_concepts_organization_id_is_active_idx" ON "withholding_concepts"("organization_id", "is_active");

CREATE INDEX IF NOT EXISTS "withholding_calculations_organization_id_invoice_id_idx" ON "withholding_calculations"("organization_id", "invoice_id");
CREATE INDEX IF NOT EXISTS "withholding_calculations_organization_id_supplier_id_year_idx" ON "withholding_calculations"("organization_id", "supplier_id", "year");
CREATE INDEX IF NOT EXISTS "withholding_calculations_store_id_idx" ON "withholding_calculations"("store_id");

CREATE UNIQUE INDEX IF NOT EXISTS "exogenous_reports_organization_id_fiscal_year_format_code_key" ON "exogenous_reports"("organization_id", "fiscal_year", "format_code");
CREATE INDEX IF NOT EXISTS "exogenous_reports_organization_id_fiscal_year_idx" ON "exogenous_reports"("organization_id", "fiscal_year");
CREATE INDEX IF NOT EXISTS "exogenous_reports_store_id_idx" ON "exogenous_reports"("store_id");

CREATE INDEX IF NOT EXISTS "exogenous_report_lines_report_id_idx" ON "exogenous_report_lines"("report_id");
CREATE INDEX IF NOT EXISTS "exogenous_report_lines_report_id_third_party_nit_idx" ON "exogenous_report_lines"("report_id", "third_party_nit");

CREATE UNIQUE INDEX IF NOT EXISTS "user_consents_user_id_consent_type_key" ON "user_consents"("user_id", "consent_type");
CREATE INDEX IF NOT EXISTS "user_consents_user_id_idx" ON "user_consents"("user_id");
CREATE INDEX IF NOT EXISTS "user_consents_consent_type_granted_idx" ON "user_consents"("consent_type", "granted");

CREATE INDEX IF NOT EXISTS "data_export_requests_user_id_requested_at_idx" ON "data_export_requests"("user_id", "requested_at");

CREATE INDEX IF NOT EXISTS "anonymization_requests_user_id_idx" ON "anonymization_requests"("user_id");
CREATE INDEX IF NOT EXISTS "anonymization_requests_status_idx" ON "anonymization_requests"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "ica_municipal_rates_municipality_code_ciiu_code_effective_d_key" ON "ica_municipal_rates"("municipality_code", "ciiu_code", "effective_date");
CREATE INDEX IF NOT EXISTS "ica_municipal_rates_municipality_code_is_active_idx" ON "ica_municipal_rates"("municipality_code", "is_active");
CREATE INDEX IF NOT EXISTS "ica_municipal_rates_department_code_idx" ON "ica_municipal_rates"("department_code");

-- ── Foreign Keys ──────────────────────────────────────────

ALTER TABLE "uvt_values" ADD CONSTRAINT "uvt_values_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "withholding_concepts" ADD CONSTRAINT "withholding_concepts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "withholding_calculations" ADD CONSTRAINT "withholding_calculations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "withholding_calculations" ADD CONSTRAINT "withholding_calculations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "withholding_calculations" ADD CONSTRAINT "withholding_calculations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "withholding_calculations" ADD CONSTRAINT "withholding_calculations_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "withholding_calculations" ADD CONSTRAINT "withholding_calculations_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "withholding_concepts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "exogenous_reports" ADD CONSTRAINT "exogenous_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exogenous_reports" ADD CONSTRAINT "exogenous_reports_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exogenous_report_lines" ADD CONSTRAINT "exogenous_report_lines_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "exogenous_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "anonymization_requests" ADD CONSTRAINT "anonymization_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "anonymization_requests" ADD CONSTRAINT "anonymization_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

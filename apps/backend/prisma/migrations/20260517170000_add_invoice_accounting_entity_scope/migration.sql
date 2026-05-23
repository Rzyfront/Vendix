-- DATA IMPACT:
-- Tables affected: invoices, invoice_resolutions, dian_configurations, payroll_runs,
-- payroll_items, accounting_entries, fiscal_transmissions, fiscal_evidences
-- Expected row changes: existing rows receive defaults for new status columns only
-- Destructive operations: drops the old organization-wide invoice-number unique
-- constraint so fiscal STORE tenants can reuse legal numbers per entity
-- FK/cascade risk: replaces fiscal accounting-entity FKs with ON DELETE RESTRICT
-- for DIAN/fiscal document ownership
-- Idempotency: guarded enum/type/column/index/constraint creation
-- Approval: DIAN own-software execution plan requested by the user

ALTER TYPE "invoice_type_enum" ADD VALUE IF NOT EXISTS 'support_document';
ALTER TYPE "invoice_type_enum" ADD VALUE IF NOT EXISTS 'support_adjustment_note';
ALTER TYPE "dian_configuration_type_enum" ADD VALUE IF NOT EXISTS 'support_document';
ALTER TYPE "dian_enablement_status_enum" ADD VALUE IF NOT EXISTS 'test_set_passed';
ALTER TYPE "dian_enablement_status_enum" ADD VALUE IF NOT EXISTS 'expired';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_document_type_enum') THEN
    CREATE TYPE "fiscal_document_type_enum" AS ENUM (
      'sales_invoice',
      'credit_note',
      'debit_note',
      'support_document',
      'support_adjustment_note',
      'payroll',
      'payroll_adjustment'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_transmission_status_enum') THEN
    CREATE TYPE "fiscal_transmission_status_enum" AS ENUM (
      'draft',
      'queued',
      'signing',
      'signed',
      'submitted',
      'accepted',
      'rejected',
      'error',
      'retrying',
      'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dian_document_status_enum') THEN
    CREATE TYPE "dian_document_status_enum" AS ENUM (
      'pending',
      'accepted',
      'rejected',
      'error',
      'not_applicable'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_accounting_status_enum') THEN
    CREATE TYPE "fiscal_accounting_status_enum" AS ENUM (
      'blocked',
      'provisional',
      'posted',
      'reversed',
      'not_applicable'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_evidence_type_enum') THEN
    CREATE TYPE "fiscal_evidence_type_enum" AS ENUM (
      'xml_signed',
      'xml_response',
      'zip_request',
      'pdf',
      'qr',
      'dian_response',
      'certificate',
      'test_set',
      'resolution'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dian_operation_mode_enum') THEN
    CREATE TYPE "dian_operation_mode_enum" AS ENUM (
      'own_software',
      'technological_provider'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'certificate_source_enum') THEN
    CREATE TYPE "certificate_source_enum" AS ENUM (
      'manual_upload_validated',
      'issuer_adapter'
    );
  END IF;
END $$;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "fiscal_document_type" "fiscal_document_type_enum",
  ADD COLUMN IF NOT EXISTS "transmission_status" "fiscal_transmission_status_enum" NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS "dian_status" "dian_document_status_enum" NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS "accounting_status" "fiscal_accounting_status_enum" NOT NULL DEFAULT 'blocked';

ALTER TABLE "invoice_resolutions"
  ADD COLUMN IF NOT EXISTS "document_type" "fiscal_document_type_enum" NOT NULL DEFAULT 'sales_invoice';

ALTER TABLE "dian_configurations"
  ADD COLUMN IF NOT EXISTS "operation_mode" "dian_operation_mode_enum" NOT NULL DEFAULT 'own_software',
  ADD COLUMN IF NOT EXISTS "certificate_fingerprint" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "certificate_subject" TEXT,
  ADD COLUMN IF NOT EXISTS "certificate_issuer" TEXT,
  ADD COLUMN IF NOT EXISTS "certificate_serial_number" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "certificate_nit" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "certificate_source" "certificate_source_enum" NOT NULL DEFAULT 'manual_upload_validated',
  ADD COLUMN IF NOT EXISTS "certificate_uploaded_at" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "enablement_evidence" JSONB,
  ADD COLUMN IF NOT EXISTS "enabled_at" TIMESTAMP(6);

ALTER TABLE "payroll_runs"
  ADD COLUMN IF NOT EXISTS "dian_status" "dian_document_status_enum" NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS "accounting_status" "fiscal_accounting_status_enum" NOT NULL DEFAULT 'blocked';

ALTER TABLE "payroll_items"
  ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "send_status" "document_send_status_enum" NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS "dian_status" "dian_document_status_enum" NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS "accounting_status" "fiscal_accounting_status_enum" NOT NULL DEFAULT 'blocked',
  ADD COLUMN IF NOT EXISTS "cune" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "qr_code" TEXT,
  ADD COLUMN IF NOT EXISTS "xml_document" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_response" JSONB,
  ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(6);

DO $$
BEGIN
  ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_accounting_entity_id_fkey";
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_accounting_entity_id_fkey"
    FOREIGN KEY ("accounting_entity_id")
    REFERENCES "accounting_entities"("id")
    ON DELETE RESTRICT
    ON UPDATE NO ACTION;

  ALTER TABLE "invoice_resolutions" DROP CONSTRAINT IF EXISTS "invoice_resolutions_accounting_entity_id_fkey";
  ALTER TABLE "invoice_resolutions"
    ADD CONSTRAINT "invoice_resolutions_accounting_entity_id_fkey"
    FOREIGN KEY ("accounting_entity_id")
    REFERENCES "accounting_entities"("id")
    ON DELETE RESTRICT
    ON UPDATE NO ACTION;

  ALTER TABLE "dian_configurations" DROP CONSTRAINT IF EXISTS "dian_configurations_accounting_entity_id_fkey";
  ALTER TABLE "dian_configurations"
    ADD CONSTRAINT "dian_configurations_accounting_entity_id_fkey"
    FOREIGN KEY ("accounting_entity_id")
    REFERENCES "accounting_entities"("id")
    ON DELETE RESTRICT
    ON UPDATE NO ACTION;

  ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_accounting_entity_id_fkey";
  ALTER TABLE "payroll_runs"
    ADD CONSTRAINT "payroll_runs_accounting_entity_id_fkey"
    FOREIGN KEY ("accounting_entity_id")
    REFERENCES "accounting_entities"("id")
    ON DELETE RESTRICT
    ON UPDATE NO ACTION;

  ALTER TABLE "payroll_items" DROP CONSTRAINT IF EXISTS "payroll_items_accounting_entity_id_fkey";
  ALTER TABLE "payroll_items"
    ADD CONSTRAINT "payroll_items_accounting_entity_id_fkey"
    FOREIGN KEY ("accounting_entity_id")
    REFERENCES "accounting_entities"("id")
    ON DELETE RESTRICT
    ON UPDATE NO ACTION;
END $$;

ALTER TABLE "invoices"
  DROP CONSTRAINT IF EXISTS "invoices_organization_id_invoice_type_invoice_number_key";

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_accounting_entity_id_invoice_type_invoice_number_key"
  ON "invoices" ("accounting_entity_id", "invoice_type", "invoice_number");

CREATE INDEX IF NOT EXISTS "invoices_accounting_entity_id_idx"
  ON "invoices" ("accounting_entity_id");

CREATE INDEX IF NOT EXISTS "invoices_organization_accounting_entity_id_idx"
  ON "invoices" ("organization_id", "accounting_entity_id");

CREATE INDEX IF NOT EXISTS "invoices_accounting_entity_fiscal_document_type_idx"
  ON "invoices" ("accounting_entity_id", "fiscal_document_type");

CREATE INDEX IF NOT EXISTS "invoice_resolutions_accounting_entity_document_type_active_idx"
  ON "invoice_resolutions" ("accounting_entity_id", "document_type", "is_active");

CREATE INDEX IF NOT EXISTS "invoice_resolutions_org_entity_document_type_idx"
  ON "invoice_resolutions" ("organization_id", "accounting_entity_id", "document_type");

CREATE INDEX IF NOT EXISTS "dian_configurations_accounting_entity_configuration_type_idx"
  ON "dian_configurations" ("accounting_entity_id", "configuration_type");

CREATE INDEX IF NOT EXISTS "dian_configurations_operation_environment_status_idx"
  ON "dian_configurations" ("operation_mode", "environment", "enablement_status");

CREATE INDEX IF NOT EXISTS "accounting_entries_org_source_entity_idx"
  ON "accounting_entries" ("organization_id", "source_type", "source_id", "accounting_entity_id");

CREATE UNIQUE INDEX IF NOT EXISTS "accounting_entries_source_entity_uq"
  ON "accounting_entries" ("organization_id", "source_type", "source_id", "accounting_entity_id")
  WHERE "source_type" IS NOT NULL
    AND "source_id" IS NOT NULL
    AND "accounting_entity_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "payroll_items_accounting_entity_dian_status_idx"
  ON "payroll_items" ("accounting_entity_id", "dian_status");

CREATE TABLE IF NOT EXISTS "fiscal_transmissions" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER NOT NULL,
  "dian_configuration_id" INTEGER,
  "document_type" "fiscal_document_type_enum" NOT NULL,
  "source_type" VARCHAR(50) NOT NULL,
  "source_id" INTEGER NOT NULL,
  "document_number" VARCHAR(50) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "request_hash" VARCHAR(128),
  "xml_hash" VARCHAR(128),
  "zip_hash" VARCHAR(128),
  "tracking_id" VARCHAR(255),
  "cufe" VARCHAR(255),
  "cude" VARCHAR(255),
  "cuds" VARCHAR(255),
  "cune" VARCHAR(255),
  "qr_code" TEXT,
  "xml_document" TEXT,
  "pdf_url" TEXT,
  "transmission_status" "fiscal_transmission_status_enum" NOT NULL DEFAULT 'queued',
  "dian_status" "dian_document_status_enum" NOT NULL DEFAULT 'pending',
  "accounting_status" "fiscal_accounting_status_enum" NOT NULL DEFAULT 'blocked',
  "provider_response" JSONB,
  "error_code" VARCHAR(100),
  "error_message" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "last_retry_at" TIMESTAMP(6),
  "sent_at" TIMESTAMP(6),
  "accepted_at" TIMESTAMP(6),
  "rejected_at" TIMESTAMP(6),
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_transmissions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_transmissions_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_transmissions_accounting_entity_id_fkey"
    FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_transmissions_dian_configuration_id_fkey"
    FOREIGN KEY ("dian_configuration_id") REFERENCES "dian_configurations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_transmissions_entity_type_idempotency_key"
  ON "fiscal_transmissions" ("accounting_entity_id", "document_type", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_transmissions_entity_type_document_number"
  ON "fiscal_transmissions" ("accounting_entity_id", "document_type", "document_number");

CREATE INDEX IF NOT EXISTS "fiscal_transmissions_org_entity_document_type_idx"
  ON "fiscal_transmissions" ("organization_id", "accounting_entity_id", "document_type");

CREATE INDEX IF NOT EXISTS "fiscal_transmissions_store_id_idx"
  ON "fiscal_transmissions" ("store_id");

CREATE INDEX IF NOT EXISTS "fiscal_transmissions_source_idx"
  ON "fiscal_transmissions" ("source_type", "source_id");

CREATE INDEX IF NOT EXISTS "fiscal_transmissions_tracking_id_idx"
  ON "fiscal_transmissions" ("tracking_id");

CREATE INDEX IF NOT EXISTS "fiscal_transmissions_dian_transmission_status_idx"
  ON "fiscal_transmissions" ("dian_status", "transmission_status");

CREATE INDEX IF NOT EXISTS "fiscal_transmissions_created_at_idx"
  ON "fiscal_transmissions" ("created_at");

CREATE TABLE IF NOT EXISTS "fiscal_evidences" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER NOT NULL,
  "fiscal_transmission_id" INTEGER,
  "evidence_type" "fiscal_evidence_type_enum" NOT NULL,
  "storage_key" TEXT,
  "content_hash" VARCHAR(128),
  "metadata" JSONB,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_evidences_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_evidences_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_evidences_accounting_entity_id_fkey"
    FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_evidences_fiscal_transmission_id_fkey"
    FOREIGN KEY ("fiscal_transmission_id") REFERENCES "fiscal_transmissions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "fiscal_evidences_org_entity_type_idx"
  ON "fiscal_evidences" ("organization_id", "accounting_entity_id", "evidence_type");

CREATE INDEX IF NOT EXISTS "fiscal_evidences_fiscal_transmission_id_idx"
  ON "fiscal_evidences" ("fiscal_transmission_id");

CREATE INDEX IF NOT EXISTS "fiscal_evidences_content_hash_idx"
  ON "fiscal_evidences" ("content_hash");

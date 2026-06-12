-- DATA IMPACT:
-- Tables affected: vendor_support_documents (new table), accounting_entries, organizations, users (additive relations only)
-- Expected row changes: 0 destructive mutations. Purely additive: new enum, new table, new relations.
-- Destructive operations: none. No DROP, TRUNCATE, DELETE, or UPDATE.
-- FK/cascade risk: new FKs only on the NEW vendor_support_documents table (org RESTRICT, journal entries SET NULL, user SET NULL).
--   No FK changes on existing tables. New relations on existing tables are back-relations only.
-- Idempotency: guarded CREATE TYPE (pg_type checks), CREATE TABLE IF NOT EXISTS,
--   CREATE INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS via DO $$ where needed.
-- Approval: Step 5 of approved plan (Módulo Fiscal Unificado para VENDIX_ADMIN).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendor_support_document_status_enum') THEN
    CREATE TYPE "vendor_support_document_status_enum" AS ENUM ('pending', 'approved', 'paid', 'void');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "vendor_support_documents" (
  "id"                          SERIAL PRIMARY KEY,
  "organization_id"             INTEGER NOT NULL,
  "vendor_nit"                  VARCHAR(20) NOT NULL,
  "vendor_name"                 VARCHAR(255) NOT NULL,
  "invoice_number"              VARCHAR(100) NOT NULL,
  "issue_date"                  DATE NOT NULL,
  "subtotal"                    DECIMAL(18, 4),
  "tax_amount"                  DECIMAL(18, 4),
  "total"                       DECIMAL(18, 4) NOT NULL,
  "currency"                    VARCHAR(3) NOT NULL DEFAULT 'COP',
  "account_code"                VARCHAR(20) NOT NULL,
  "description"                 TEXT,
  "pdf_s3_key"                  TEXT,
  "status"                      "vendor_support_document_status_enum" NOT NULL DEFAULT 'pending',
  "approved_journal_entry_id"   INTEGER,
  "paid_journal_entry_id"       INTEGER,
  "created_by_user_id"          INTEGER,
  "created_at"                  TIMESTAMP(6) DEFAULT now(),
  "updated_at"                  TIMESTAMP(6) DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "vendor_support_documents_org_nit_invoice_key"
  ON "vendor_support_documents" ("organization_id", "vendor_nit", "invoice_number");

CREATE INDEX IF NOT EXISTS "vendor_support_documents_org_status_idx"
  ON "vendor_support_documents" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "vendor_support_documents_org_issue_date_idx"
  ON "vendor_support_documents" ("organization_id", "issue_date");

-- FK: organization (RESTRICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_support_documents_organization_id_fkey'
  ) THEN
    ALTER TABLE "vendor_support_documents"
      ADD CONSTRAINT "vendor_support_documents_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: approved_journal_entry (SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_support_documents_approved_journal_entry_id_fkey'
  ) THEN
    ALTER TABLE "vendor_support_documents"
      ADD CONSTRAINT "vendor_support_documents_approved_journal_entry_id_fkey"
      FOREIGN KEY ("approved_journal_entry_id") REFERENCES "accounting_entries"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: paid_journal_entry (SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_support_documents_paid_journal_entry_id_fkey'
  ) THEN
    ALTER TABLE "vendor_support_documents"
      ADD CONSTRAINT "vendor_support_documents_paid_journal_entry_id_fkey"
      FOREIGN KEY ("paid_journal_entry_id") REFERENCES "accounting_entries"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: created_by_user (SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_support_documents_created_by_user_id_fkey'
  ) THEN
    ALTER TABLE "vendor_support_documents"
      ADD CONSTRAINT "vendor_support_documents_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

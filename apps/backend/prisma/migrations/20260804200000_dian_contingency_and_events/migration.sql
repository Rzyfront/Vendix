-- DATA IMPACT:
-- Tables affected: invoices (ADD COLUMN only), fiscal_transmission_status_enum (ADD VALUE only),
--                  dian_document_events (CREATE TABLE only)
-- Expected row changes: NONE. No UPDATE, no DELETE, no column drop, no table drop.
-- Destructive operations: none
-- FK/cascade risk: dian_document_events -> invoices ON DELETE CASCADE is intentional:
--   an event is meaningless without its invoice, and invoices are never hard-deleted
--   by the app (they are cancelled). No inbound FK is dropped or altered.
-- Idempotency: every statement guarded by IF NOT EXISTS / catalog check.
-- Approval: DIAN contingency + RADIAN events plan, approved in chat 2026-08-04.

-- 1. Contingency transmission state (Anexo Técnico 1.9 §12).
--    A document expedited under contingency is neither `submitted` nor `error`:
--    it was legitimately delivered to the acquirer without prior validation and
--    still owes the DIAN a transmission within 48 h.
ALTER TYPE "fiscal_transmission_status_enum" ADD VALUE IF NOT EXISTS 'contingency';

-- 2. Contingency bookkeeping on the invoice.
--    contingency_type: '03' = facturador (talonario/papel, transcribed later),
--                      '04' = DIAN unavailable (same prefix/number, re-signed).
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "contingency_type" VARCHAR(2);
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "contingency_declared_at" TIMESTAMP(6);
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "contingency_deadline" TIMESTAMP(6);
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "contingency_reason" TEXT;

-- Partial index: the 48 h sweeper only ever asks for documents that still owe a
-- transmission, which is a tiny slice of the table.
CREATE INDEX IF NOT EXISTS "idx_invoices_contingency_pending"
  ON "invoices" ("contingency_deadline")
  WHERE "contingency_type" IS NOT NULL;

-- 3. RADIAN / DIAN document events (ApplicationResponse sent via
--    SendEventUpdateStatus). One row per event emitted for a document.
CREATE TABLE IF NOT EXISTS "dian_document_events" (
  "id"                    SERIAL PRIMARY KEY,
  "organization_id"       INTEGER NOT NULL,
  "store_id"              INTEGER,
  "invoice_id"            INTEGER NOT NULL,
  "dian_configuration_id" INTEGER,
  -- DIAN event code: 030 acuse, 031 reclamo, 032 recibo del bien/servicio,
  -- 033 aceptación expresa, 034 aceptación tácita.
  "event_code"            VARCHAR(3) NOT NULL,
  "event_number"          VARCHAR(50),
  -- CUDE of the ApplicationResponse itself (its own document key).
  "cude"                  VARCHAR(255),
  -- CUFE of the referenced invoice, denormalized so an event stays diagnosable
  -- even if the invoice row is later re-issued.
  "referenced_cufe"       VARCHAR(255),
  "status"                VARCHAR(20) NOT NULL DEFAULT 'pending',
  "dian_status_code"      VARCHAR(20),
  "dian_status_message"   TEXT,
  "request_xml"           TEXT,
  "response_xml"          TEXT,
  "issued_at"             TIMESTAMP(6),
  "created_at"            TIMESTAMP(6) DEFAULT now(),
  "updated_at"            TIMESTAMP(6) DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dian_document_events_invoice_id_fkey'
  ) THEN
    ALTER TABLE "dian_document_events"
      ADD CONSTRAINT "dian_document_events_invoice_id_fkey"
      FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dian_document_events_organization_id_fkey'
  ) THEN
    ALTER TABLE "dian_document_events"
      ADD CONSTRAINT "dian_document_events_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dian_document_events_store_id_fkey'
  ) THEN
    ALTER TABLE "dian_document_events"
      ADD CONSTRAINT "dian_document_events_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_dian_document_events_invoice"
  ON "dian_document_events" ("invoice_id", "event_code");
CREATE INDEX IF NOT EXISTS "idx_dian_document_events_status"
  ON "dian_document_events" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_dian_document_events_org"
  ON "dian_document_events" ("organization_id", "store_id");

-- One accepted event of a given code per document: re-sending 030 for the same
-- invoice must not create a second accepted row. Partial so that failed attempts
-- can be retried and kept for audit.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dian_document_events_accepted"
  ON "dian_document_events" ("invoice_id", "event_code")
  WHERE "status" = 'accepted';

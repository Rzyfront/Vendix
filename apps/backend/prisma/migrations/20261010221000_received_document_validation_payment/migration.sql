-- DATA IMPACT:
-- Tables affected: received_documents (additive validation/payment columns only).
-- Expected row changes: none; existing rows receive conservative column defaults
--   and are not backfilled from untrusted or incomplete historical evidence.
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: enum creation and columns are guarded; safe to re-run.
-- Approval: P0-A of the approved received-documents plan.

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'received_document_payment_condition_enum'
  ) THEN
    CREATE TYPE "received_document_payment_condition_enum" AS ENUM ('cash', 'credit', 'unknown');
  END IF;
END $$;

ALTER TABLE "received_documents"
  ADD COLUMN IF NOT EXISTS "structural_validation_status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "signature_validation_status" VARCHAR(30) NOT NULL DEFAULT 'not_verified',
  ADD COLUMN IF NOT EXISTS "dian_validation_status" VARCHAR(30) NOT NULL DEFAULT 'not_checked',
  ADD COLUMN IF NOT EXISTS "payment_condition" "received_document_payment_condition_enum" NOT NULL DEFAULT 'unknown';

COMMIT;

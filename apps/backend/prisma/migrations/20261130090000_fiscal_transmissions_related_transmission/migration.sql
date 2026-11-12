-- DATA IMPACT: none (schema only)
-- Tables affected: fiscal_transmissions (adds one nullable column, one index, one self-referencing FK)
-- Expected row changes: 0 (no existing row is read or modified; the column stays NULL)
-- Destructive operations: none
-- FK/cascade risk: self-FK is ON DELETE RESTRICT; a document with notes cannot be deleted
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, guarded FK via pg_constraint
-- Purpose: link a platform credit/debit note to the invoice it corrects

ALTER TABLE "fiscal_transmissions"
  ADD COLUMN IF NOT EXISTS "related_transmission_id" INTEGER;

CREATE INDEX IF NOT EXISTS "fiscal_transmissions_related_transmission_id_idx"
  ON "fiscal_transmissions"("related_transmission_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fiscal_transmissions_related_transmission_id_fkey'
  ) THEN
    ALTER TABLE "fiscal_transmissions"
      ADD CONSTRAINT "fiscal_transmissions_related_transmission_id_fkey"
      FOREIGN KEY ("related_transmission_id")
      REFERENCES "fiscal_transmissions"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

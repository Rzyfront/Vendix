-- DATA IMPACT:
-- Tables affected: invoice_items, invoices
-- Expected row changes: zero; nullable columns only, with no defaults or backfill
-- Destructive operations: none
-- FK/cascade risk: source reference uses ON DELETE SET NULL and ON UPDATE NO ACTION
-- Idempotency: columns/index use IF NOT EXISTS; FK creation is guarded by pg_constraint

ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "source_invoice_item_id" INTEGER;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "credit_limit_reserved_at" TIMESTAMP(6);

CREATE INDEX IF NOT EXISTS "invoice_items_source_invoice_item_id_idx"
  ON "invoice_items"("source_invoice_item_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_items_source_invoice_item_id_fkey'
      AND conrelid = 'invoice_items'::regclass
  ) THEN
    ALTER TABLE "invoice_items"
      ADD CONSTRAINT "invoice_items_source_invoice_item_id_fkey"
      FOREIGN KEY ("source_invoice_item_id")
      REFERENCES "invoice_items"("id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;
END $$;

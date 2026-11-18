-- DATA IMPACT:
-- Tables affected: invoices (schema only)
-- Expected row changes: none; the new column is nullable and no row is backfilled
-- Destructive operations: none
-- FK/cascade risk: new FK invoices.purchase_order_id -> purchase_orders.id with
--   ON DELETE RESTRICT (no cascade): an OC that already has a support document
--   cannot be deleted, so the fiscal trace survives
-- Idempotency: ADD COLUMN IF NOT EXISTS, guarded ADD CONSTRAINT, CREATE INDEX IF NOT EXISTS
-- Approval: QUI-684 (H2, "migración aditiva: FK opcional purchase_order_id en el documento")

-- QUI-684 H2: link a support document to the purchase order it was generated from.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "purchase_order_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_purchase_order_id_fkey'
  ) THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_purchase_order_id_fkey"
      FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "invoices_purchase_order_id_idx"
  ON "invoices" ("purchase_order_id");

-- QUI-684 H1: one active support document per purchase order. A cancelled or
-- voided document frees the slot, so a new one can be issued after it.
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_po_active_support_document_key"
  ON "invoices" ("purchase_order_id")
  WHERE "purchase_order_id" IS NOT NULL
    AND "invoice_type" = 'support_document'
    AND "status" NOT IN ('cancelled', 'voided');

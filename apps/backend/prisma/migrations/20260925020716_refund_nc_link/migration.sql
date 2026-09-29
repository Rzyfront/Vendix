-- DATA IMPACT:
-- Tables affected: invoices (ADD 1 nullable column, no backfill: 100% historic stays NULL = nota manual); credit_note_refund_items (NEW empty bridge table)
-- Expected row changes: 0 (column added NULL; new table starts empty; no UPDATE/DELETE)
-- Destructive operations: none (no drops, no CASCADE, no DELETE, no UPDATE)
-- FK/cascade risk: none (3 new FKs, all ON DELETE RESTRICT ON UPDATE NO ACTION; no existing FK touched; invoices/refunds/refund_items are never deleted, only state-changed)
-- Idempotency: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + DO-block guarded FK adds; re-runnable with 0 changes
-- Approval: CP-REFUND-FLOW-REDESIGN paso 7, approved for execution by owner
-- NOTE: created via orchestrator-authorized `migrate diff` + `migrate deploy` (not `migrate dev`) because the repo shadow DB is broken pre-existing (P3006 in 20260807220000_align_platform_fiscal_identity, untouched). SQL congruent with `migrate diff` schema-to-schema output.

-- AlterTable: refund link on credit notes (paso 7: NC guiada por reembolso).
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "refund_id" INTEGER;

-- CreateTable: per-line refund<->NC bridge (paso 7: cobertura estructural, nunca monto/fecha flojo).
CREATE TABLE IF NOT EXISTS "credit_note_refund_items" (
    "id" SERIAL NOT NULL,
    "credit_note_id" INTEGER NOT NULL,
    "refund_item_id" INTEGER NOT NULL,
    "covered_qty" INTEGER NOT NULL,
    "covered_amount" DECIMAL(12,2),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_note_refund_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "credit_note_refund_items_refund_item_id_idx" ON "credit_note_refund_items"("refund_item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "credit_note_refund_items_credit_note_id_refund_item_id_key" ON "credit_note_refund_items"("credit_note_id", "refund_item_id");
CREATE INDEX IF NOT EXISTS "invoices_refund_id_idx" ON "invoices"("refund_id");

-- AddForeignKey (guarded: pg_constraint check, same idempotent pattern as prior migrations).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_note_refund_items_credit_note_id_fkey') THEN
    ALTER TABLE "credit_note_refund_items" ADD CONSTRAINT "credit_note_refund_items_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_note_refund_items_refund_item_id_fkey') THEN
    ALTER TABLE "credit_note_refund_items" ADD CONSTRAINT "credit_note_refund_items_refund_item_id_fkey" FOREIGN KEY ("refund_item_id") REFERENCES "refund_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_refund_id_fkey') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

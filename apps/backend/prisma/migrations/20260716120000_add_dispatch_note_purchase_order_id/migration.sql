-- DATA IMPACT:
-- Tables affected: dispatch_notes (adds nullable column purchase_order_id + FK + index)
-- Expected row changes: none — additive nullable column; all existing rows default to NULL
-- Destructive operations: none (no DROP / no CASCADE / no DELETE / no UPDATE)
-- FK/cascade risk: FK dispatch_notes.purchase_order_id -> purchase_orders.id is
--   ON DELETE SET NULL, ON UPDATE NO ACTION. purchase_orders is the parent and is
--   never deleted by this constraint; deleting a PO only nulls the reference on
--   its remisiones (no cascade delete of dispatch notes).
-- Idempotency: guarded by IF NOT EXISTS (column + index) and a pg_constraint check (FK).
-- Approval: additive-only order-first receipt bridge (FASE A). No data mutation.

-- 1. Additive nullable column.
ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "purchase_order_id" INTEGER;

-- 2. Index for the new FK (matches Prisma @@index naming).
CREATE INDEX IF NOT EXISTS "dispatch_notes_purchase_order_id_idx"
  ON "dispatch_notes"("purchase_order_id");

-- 3. Foreign key (guarded so re-runs are safe). ON DELETE SET NULL keeps the
--    remisión history alive if its purchase order is ever removed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dispatch_notes_purchase_order_id_fkey'
  ) THEN
    ALTER TABLE "dispatch_notes"
      ADD CONSTRAINT "dispatch_notes_purchase_order_id_fkey"
      FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

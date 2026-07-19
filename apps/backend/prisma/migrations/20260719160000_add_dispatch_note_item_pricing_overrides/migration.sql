-- DATA IMPACT:
-- Tables affected: dispatch_note_items (add columns new_base_price, new_profit_margin)
-- Expected row changes: none. Two nullable numeric columns; existing rows keep NULL.
-- Destructive operations: none
-- FK/cascade risk: none (plain nullable DECIMAL columns, no FK, no constraints)
-- Idempotency: guarded by ADD COLUMN IF NOT EXISTS (safe to re-run)
-- Approval: QUI-425 — propagar overrides de precio (new_base_price/new_profit_margin)
--           del editor "Crear y recibir" a la recepción por remisión (dispatch_note
--           inbound purchase_receipt). Sin estas columnas los overrides quedan
--           display-only porque el DTO de la remisión no los transporta a receive().

ALTER TABLE "dispatch_note_items" ADD COLUMN IF NOT EXISTS "new_base_price" DECIMAL(12,2);
ALTER TABLE "dispatch_note_items" ADD COLUMN IF NOT EXISTS "new_profit_margin" DECIMAL(5,2);

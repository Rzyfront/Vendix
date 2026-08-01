-- DATA IMPACT:
-- Tables affected: dispatch_note_items (add ONE nullable column purchase_order_item_id)
-- Expected row changes: ZERO. The column is nullable with no DEFAULT, so every
--   pre-existing row keeps NULL and no row is rewritten, deleted or updated.
-- Destructive operations: none. No DROP, no TRUNCATE, no DELETE, no UPDATE.
-- FK/cascade risk: dispatch_note_items.purchase_order_item_id -> purchase_order_items(id)
--   ON DELETE SET NULL ON UPDATE CASCADE. Never CASCADE on delete: removing a
--   purchase-order line must NOT delete the receipt line that recorded it, it must
--   only detach the link.
-- Idempotency: guarded by ADD COLUMN IF NOT EXISTS, DO $$ ... EXCEPTION WHEN
--   duplicate_object, and CREATE INDEX IF NOT EXISTS. Safe to re-run.
-- Approval: additive-only schema change; no data mutation, so no snapshot required.
--
-- WHY:
-- `CreateDispatchNoteItemDto` already accepts `purchase_order_item_id` and
-- `DispatchNotesService.createPurchaseReceipt` validates it, but the value was
-- silently dropped because no column existed. That forced
-- `delegatePurchaseReceiptToPurchaseOrder` to re-derive the purchase-order line
-- from product_id + product_variant_id, which cannot disambiguate two PO lines
-- of the same product/variant. Persisting the id makes the link explicit.
-- Nullable because sales dispatches (and every pre-existing row) have no PO line.

ALTER TABLE "dispatch_note_items" ADD COLUMN IF NOT EXISTS "purchase_order_item_id" INTEGER;

DO $$ BEGIN
  ALTER TABLE "dispatch_note_items" ADD CONSTRAINT "dispatch_note_items_purchase_order_item_id_fkey"
    FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "dispatch_note_items_purchase_order_item_id_idx"
  ON "dispatch_note_items" ("purchase_order_item_id");

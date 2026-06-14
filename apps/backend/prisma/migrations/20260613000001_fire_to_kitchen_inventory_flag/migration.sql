-- =====================================================================
-- Restaurant Suite Fase D — Fire-to-Kitchen Inventory Flag
-- =====================================================================
-- DATA IMPACT:
-- Tables affected: order_items (additive: 1 new boolean column)
-- Expected row changes: 0 destructive mutations.
--   - ALTER TABLE ADD COLUMN with server-side DEFAULT backfills all
--     existing order_items rows to FALSE in-place atomically (no UPDATE
--     issued; the default is a constant).
--   - The column is the guard anti-doble-descuento: when an order_item
--     is a `prepared` product that has been fired to kitchen, the
--     KitchenFireService flips it to TRUE. PaymentsService then skips
--     the item at sale time.
--   - Default false keeps the entire retail flow unchanged: physical /
--     service products never get marked, and payments' stock decrement
--     for them continues to work as today.
-- Destructive operations: none.
--   - No DROP, TRUNCATE, DELETE, UPDATE (without WHERE).
--   - No FK changes on existing tables.
--   - No enum changes.
-- FK/cascade risk: none (new column, no constraint).
-- Idempotency:
--   - ADD COLUMN IF NOT EXISTS
--   - CREATE INDEX IF NOT EXISTS
-- Approval: documented in plan logical-herding-meteor §Fase D.
-- =====================================================================

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "inventory_consumed_at_fire" BOOLEAN NOT NULL DEFAULT false;

-- Partial index for fast lookup of "which items still need fire-to-kitchen
-- inventory consume?" Most rows stay at the default FALSE, so a partial
-- index on TRUE keeps it tiny and hot.
CREATE INDEX IF NOT EXISTS "idx_order_items_inv_consumed"
  ON "order_items"("inventory_consumed_at_fire")
  WHERE "inventory_consumed_at_fire" = true;

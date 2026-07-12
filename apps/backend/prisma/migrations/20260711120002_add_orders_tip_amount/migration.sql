-- DATA IMPACT:
-- Tables affected: orders
-- Expected row changes: none (additive nullable column, no backfill, no default)
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by ADD COLUMN IF NOT EXISTS
-- Approval: dine-in QR plan (Ola 0, Step 2)
--
-- Dine-in QR: optional tip captured when closing the bill.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tip_amount" NUMERIC(12,2);

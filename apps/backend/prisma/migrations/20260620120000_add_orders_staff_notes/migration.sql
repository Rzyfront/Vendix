-- DATA IMPACT: 0 rows mutated; additive only (orders.notes nullable VARCHAR(500))
-- Tables affected: orders (schema only)
-- Expected row changes: none (additive nullable column, no default)
-- Destructive operations: none (no DROP/TRUNCATE/CASCADE/DELETE/UPDATE)
-- FK/cascade risk: none — no FK, plain nullable text column
-- Idempotency: guarded by ADD COLUMN IF NOT EXISTS
-- Approval: additive-only staff note for orders (set at creation, never sent to customer)

-- 1. Additive nullable column for staff-only notes
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "notes" VARCHAR(500);

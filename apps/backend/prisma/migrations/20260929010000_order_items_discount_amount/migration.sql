-- DATA IMPACT: none (additive nullable column)
-- Tables affected: order_items (new column discount_amount, NULL for every existing row)
-- Contract: base (pre-tax) discount already applied to the line. NULL = legacy
-- contract (order discount is gross and is re-distributed by gross per line).
-- Destructive operations: none. No backfill, no UPDATE.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2);

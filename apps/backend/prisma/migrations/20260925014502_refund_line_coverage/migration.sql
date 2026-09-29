-- DATA IMPACT:
-- Tables affected: order_items (ADD 2 nullable columns; backfill on existing rows)
-- Expected row changes: backfill ~1108 rows on dev dataset 2026-09-25 (UPDATE 17 with ledger + UPDATE 1091 without); 0 on fresh DBs
-- Destructive operations: none (no drops, no CASCADE, no DELETE)
-- FK/cascade risk: none (no FK changes; new columns carry no constraints)
-- Idempotency: ADD COLUMN IF NOT EXISTS + WHERE-guarded UPDATEs (IS DISTINCT FROM / IS NULL); re-runnable with 0 changes
-- Approval: CP-REFUND-FLOW-REDESIGN paso 3, approved for execution by owner; dry-run validated with rollback 2026-09-25 (reconciliation 0 rows)
-- NOTE: created via orchestrator-authorized `migrate diff` + `migrate deploy` (not `migrate dev`) because the repo shadow DB is broken pre-existing (P3006 in 20260807220000_align_platform_fiscal_identity, untouched). SQL congruent with `migrate diff` schema-to-schema output.

-- AlterTable: per-line refund coverage cache (truth stays the refund_items ledger; see schema comment).
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "refunded_qty" INTEGER;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "refunded_amount" DECIMAL(12,2);

-- Backfill #1: lines with ledger coverage.
UPDATE "order_items" oi
SET "refunded_qty" = s.qty,
    "refunded_amount" = s.amt
FROM (
  SELECT "order_item_id",
         SUM("quantity")::int AS qty,
         COALESCE(SUM("refund_amount"), 0) AS amt
  FROM "refund_items"
  GROUP BY "order_item_id"
) s
WHERE oi."id" = s."order_item_id"
  AND (oi."refunded_qty" IS DISTINCT FROM s.qty OR oi."refunded_amount" IS DISTINCT FROM s.amt);

-- Backfill #2: lines without ledger -> 0/0.00.
UPDATE "order_items"
SET "refunded_qty" = 0,
    "refunded_amount" = 0.00
WHERE "refunded_qty" IS NULL OR "refunded_amount" IS NULL;

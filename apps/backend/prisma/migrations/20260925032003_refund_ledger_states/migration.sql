-- DATA IMPACT:
-- Tables affected: order_items (recompute derived refunded_qty/refunded_amount cache only)
-- Expected row changes: 0 on dev dataset 2026-09-25 (no failed-state refund_items; 2 NULL-cache lines left untouched per NULL=0); N>0 only where failed/cancelled/requested/approved refunds overstated the cache
-- Destructive operations: none (no drops, no CASCADE, no DELETE; UPDATEs recompute a derived cache toward ledger truth, never business facts)
-- FK/cascade risk: none (no FK changes; refunds/refund_items untouched, read-only JOIN)
-- Idempotency: both UPDATEs WHERE-guarded (IS DISTINCT FROM + NOT EXISTS); re-runnable with 0 changes
-- Approval: CP-REFUND-FLOW-REDESIGN M2 fix-forward (review 78/100), same execution approval as paso 3; dry-run counts validated 2026-09-25
-- NOTE: data-only corrective migration (schema unchanged — comments only). Created as raw SQL + `migrate deploy` because the repo shadow DB is broken pre-existing (P3006 in 20260807220000_align_platform_fiscal_identity, untouched), same authorized path as 20260925014502_refund_line_coverage.

-- M2 fix-forward: the step-3 backfill aggregated refund_items across ALL
-- states, so failed/cancelled refunds with persisted items permanently
-- overstated the per-line cache (badges, guards, ticket). Ledger truth is
-- now LEDGER states only (completed/pending_approval/processing — same set
-- as the ceiling, see REFUND_LEDGER_STATES). Recompute affected lines.

-- Corrective #1: lines with ledger-state items whose cache differs.
UPDATE "order_items" oi
SET "refunded_qty" = s.qty,
    "refunded_amount" = s.amt
FROM (
  SELECT ri."order_item_id",
         SUM(ri."quantity")::int AS qty,
         COALESCE(SUM(ri."refund_amount"), 0) AS amt
  FROM "refund_items" ri
  JOIN "refunds" r ON r."id" = ri."refund_id"
  WHERE r."state" IN ('completed', 'pending_approval', 'processing')
  GROUP BY ri."order_item_id"
) s
WHERE oi."id" = s."order_item_id"
  AND (oi."refunded_qty" IS DISTINCT FROM s.qty OR oi."refunded_amount" IS DISTINCT FROM s.amt);

-- Corrective #2: lines with a NON-NULL non-zero cache but zero ledger-state
-- items (only failed/cancelled/requested/approved items, or orphan cache).
-- NULL cache is left untouched (NULL = 0 by design).
UPDATE "order_items" oi
SET "refunded_qty" = 0,
    "refunded_amount" = 0.00
WHERE ((oi."refunded_qty" IS NOT NULL AND oi."refunded_qty" <> 0)
    OR (oi."refunded_amount" IS NOT NULL AND oi."refunded_amount" <> 0.00))
  AND NOT EXISTS (
    SELECT 1
    FROM "refund_items" ri
    JOIN "refunds" r ON r."id" = ri."refund_id"
    WHERE ri."order_item_id" = oi."id"
      AND r."state" IN ('completed', 'pending_approval', 'processing')
  );

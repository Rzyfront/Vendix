-- QA local: new order lines since 2026-09-23 UTC. The original DB-12
-- count(*)>1 audit was invalid: multi-location physical slices and BOM leaves
-- legitimately write multiple rows per order_item_id.
WITH neg AS (
  SELECT order_item_id, SUM(-quantity_change) AS units, COUNT(*) AS slices
  FROM inventory_transactions
  WHERE order_item_id IS NOT NULL AND quantity_change < 0
  GROUP BY order_item_id
), physical AS (
  SELECT oi.id, oi.inventory_committed, oi.stock_units_consumed, oi.quantity,
         COALESCE(neg.units, 0) AS units, COALESCE(neg.slices, 0) AS slices
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  JOIN products p ON p.id = oi.product_id
  LEFT JOIN neg ON neg.order_item_id = oi.id
  WHERE oi.created_at >= TIMESTAMP '2026-09-23 00:00:00'
    AND p.product_type = 'physical'
)
SELECT COUNT(*) FILTER (WHERE inventory_committed) AS committed_lines,
       COUNT(*) FILTER (WHERE NOT inventory_committed AND units > 0) AS unclaimed_deductions,
       COUNT(*) FILTER (WHERE inventory_committed AND units <> COALESCE(stock_units_consumed, quantity)) AS unit_mismatches,
       COUNT(*) FILTER (WHERE inventory_committed AND units = COALESCE(stock_units_consumed, quantity)) AS exact_lines
FROM physical;

-- DB-27 stage-aware check: paid, non-terminal physical orders since cut must
-- have a reservation row (active before fulfillment, consumed afterward).
SELECT COUNT(*) AS paid_physical_orders_without_reservation
FROM (
  SELECT o.id
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN products p ON p.id = oi.product_id AND p.product_type = 'physical'
  LEFT JOIN stock_reservations r
    ON r.reserved_for_type = 'order' AND r.reserved_for_id = o.id
  WHERE o.created_at >= TIMESTAMP '2026-09-23 00:00:00'
    AND o.total_paid > 0
    AND o.state NOT IN ('draft', 'cancelled', 'refunded')
  GROUP BY o.id
  HAVING COUNT(DISTINCT r.id) = 0
) missing;

-- A live prepared/BOM post-cut sample was not manufactured solely for QA;
-- the repository-level restaurant skip cases are in the focused Jest suite.
SELECT COUNT(*) AS prepared_postcut_lines,
       COUNT(*) FILTER (WHERE oi.inventory_consumed_at_fire) AS fired_lines
FROM order_items oi
JOIN products p ON p.id = oi.product_id
WHERE oi.created_at >= TIMESTAMP '2026-09-23 00:00:00'
  AND p.product_type = 'prepared';

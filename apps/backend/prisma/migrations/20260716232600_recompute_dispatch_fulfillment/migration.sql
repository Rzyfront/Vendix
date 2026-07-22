-- DATA IMPACT:
-- Tables affected: orders (re-sync de la columna dispatch_fulfillment).
-- Expected row changes:
--   - Recalcula `orders.dispatch_fulfillment` para TODA orden desde el rollup
--     actual de `dispatch_note_items` no-void (misma regla que el backfill
--     original 20260716120005): full / partial / none por cobertura de líneas.
--   - Corrige el bug C (columna WRITE-ONCE): las órdenes que quedaron con un
--     valor stale tras su primera remisión se re-sincronizan aquí. A partir de
--     este deploy, el DispatchFulfillmentListener mantiene la columna al día en
--     runtime (confirm/deliver/void) + recompute inline en createFromOrder.
-- Destructive operations: none (solo UPDATE con WHERE; sin DROP/TRUNCATE/CASCADE).
-- FK/cascade risk: none.
-- Idempotency: el UPDATE es un re-sync determinista — recalcula el valor desde
--   el estado actual de la data, por lo que re-ejecutarlo produce el mismo
--   resultado (safe re-run). No crea enum ni columna (ya existen desde
--   20260716120005; se omiten a propósito para no chocar con el estado aplicado).
-- Approval: Plan Despacho Remediación P0 — bug C (dispatch_fulfillment stale).

-- Re-sync desde `dispatch_note_items` no-void.
--   full    → suma(dispatched_quantity) ≥ quantity en TODAS las líneas
--   partial → suma > 0 en al menos una línea (pero no full en todas)
--   none    → sin notas o todo en cero
WITH line_rollup AS (
  SELECT
    oi.order_id,
    oi.id AS order_item_id,
    oi.quantity::numeric AS ordered_qty,
    COALESCE((
      SELECT SUM(dni.dispatched_quantity)
      FROM dispatch_note_items dni
      JOIN dispatch_notes dn ON dn.id = dni.dispatch_note_id
      WHERE dni.sales_order_item_id = oi.id
        AND dn.status <> 'voided'
    ), 0)::numeric AS dispatched_qty
  FROM order_items oi
), per_order AS (
  SELECT
    order_id,
    COUNT(*) FILTER (WHERE dispatched_qty >= ordered_qty AND ordered_qty > 0) AS full_lines,
    COUNT(*) FILTER (WHERE dispatched_qty > 0 AND dispatched_qty < ordered_qty) AS partial_lines,
    COUNT(*) AS total_lines
  FROM line_rollup
  GROUP BY order_id
)
UPDATE "orders" o
SET "dispatch_fulfillment" = CASE
  WHEN COALESCE(p.total_lines, 0) = 0 THEN 'none'::"dispatch_fulfillment_enum"
  WHEN p.full_lines = p.total_lines THEN 'full'::"dispatch_fulfillment_enum"
  WHEN p.full_lines > 0 OR p.partial_lines > 0 THEN 'partial'::"dispatch_fulfillment_enum"
  ELSE 'none'::"dispatch_fulfillment_enum"
END
FROM per_order p
WHERE p.order_id = o.id
  AND o."dispatch_fulfillment" IS DISTINCT FROM (CASE
    WHEN COALESCE(p.total_lines, 0) = 0 THEN 'none'::"dispatch_fulfillment_enum"
    WHEN p.full_lines = p.total_lines THEN 'full'::"dispatch_fulfillment_enum"
    WHEN p.full_lines > 0 OR p.partial_lines > 0 THEN 'partial'::"dispatch_fulfillment_enum"
    ELSE 'none'::"dispatch_fulfillment_enum"
  END);

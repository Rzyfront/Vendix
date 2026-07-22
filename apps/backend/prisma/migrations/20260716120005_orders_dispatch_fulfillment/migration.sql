-- DATA IMPACT:
-- Tables affected: orders (adds dispatch_fulfillment enum default 'none')
-- Expected row changes:
--   - backfill: para cada orden, se calcula `dispatch_fulfillment` desde
--     `dispatch_note_items` no-void según la regla del plan:
--       full    → suma(dispatched_quantity) ≥ quantity por línea
--       partial → suma > 0 en al menos una línea
--       none    → sin notas o todo en cero
--   - additive nullable default 'none' en schema; backfill explícito abajo.
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: IF NOT EXISTS en columna + DO $$ en enum.
-- Approval: Plan Despacho Economía (FASE 6) — filtrado inteligente de órdenes.

-- 1. Enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispatch_fulfillment_enum') THEN
    CREATE TYPE "dispatch_fulfillment_enum" AS ENUM ('none', 'partial', 'full');
  END IF;
END $$;

-- 2. Columna.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "dispatch_fulfillment" "dispatch_fulfillment_enum" NOT NULL DEFAULT 'none';

-- 3. Backfill desde `dispatch_note_items` no-void.
--    Consideramos una orden DESPACHABLE (any dispatch notes confirman líneas)
--    y FULL cuando todas las líneas de la orden están cubiertas.
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
WHERE p.order_id = o.id;
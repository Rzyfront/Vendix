-- DATA IMPACT:
-- Tables affected: purchase_orders (UPDATE tax_amount, total_amount, payment_status)
-- Expected row changes (verificado read-only 2026-07-20):
--   PROD (565 OCs): normalizacion total/tax -> 2 filas (#545 y #546: linea con IVA 19% cuyo
--     total_amount estaba en NETO -> se lleva a BRUTO). delta_total_sum = +6,708,716.13 COP
--     (IVA real presente en las lineas, no inventado). payment_status recalc -> 0 flips.
--   DEV: normalizacion -> 12 filas (#124-139, lineas con IVA en neto). status recalc -> 0 flips.
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE; cada UPDATE con WHERE + guarda "solo si cambia").
-- FK/cascade risk: none.
-- Idempotency: cada UPDATE incluye la condicion ">= 0.01" y "payment_status <> new_status";
--   re-ejecutar la migracion es un no-op.
-- Safety-by-construction (por que este backfill NO corrompe datos financieros):
--   * tax_amount = GREATEST(SUM(line tax), header tax) -> NUNCA borra un IVA guardado a nivel
--     header. Protege OCs legacy "header-only-tax" (IVA en purchase_orders.tax_amount con lineas
--     en 0). Verificado en dev: las 6 OCs header-only (#92-97) quedan con delta 0.
--   * subtotal_amount NO se recomputa desde lineas -> respeta subtotales legacy que no cuadran con
--     cantidades editadas a posteriori (p.ej. lineas con qty=0); evita voltear totales sin impacto
--     de pago (dev #62 queda intacto).
--   * payment_status recalc EXCLUYE pagos con amount=NaN (Postgres ordena NaN como +infinito, con lo
--     que "paid >= total" daria un falso 'paid') y EXCLUYE OCs cancelled (estado de pago sellado).
--   * La contabilidad NO lee total_amount (postea desde batch_amount de lineas), asi que esta
--     normalizacion no altera ningun asiento existente.
-- Approval: gated (Fase 4). Pre-check read-only en prod + dry-run en dev presentados al usuario
--   para firma antes del merge a main que dispara el deploy.

-- ── 1) Normalizar total_amount a BRUTO (incluir el IVA) sin recomputar subtotal_amount ──
UPDATE "purchase_orders" po
SET "tax_amount"   = t.new_tax,
    "total_amount" = t.new_total,
    "updated_at"   = CURRENT_TIMESTAMP
FROM (
  SELECT po.id,
         GREATEST(COALESCE(lt.line_tax, 0), COALESCE(po."tax_amount", 0)) AS new_tax,
         ROUND((COALESCE(po."subtotal_amount", 0)
                - COALESCE(po."discount_amount", 0)
                + GREATEST(COALESCE(lt.line_tax, 0), COALESCE(po."tax_amount", 0))
                + COALESCE(po."shipping_cost", 0))::numeric, 2) AS new_total
  FROM "purchase_orders" po
  LEFT JOIN (
    SELECT "purchase_order_id" AS po_id,
           ROUND(SUM(COALESCE("tax_amount", 0))::numeric, 2) AS line_tax
    FROM "purchase_order_items"
    GROUP BY "purchase_order_id"
  ) lt ON lt.po_id = po.id
) t
WHERE t.id = po.id
  AND ( ABS(COALESCE(po."tax_amount", 0)   - t.new_tax)   >= 0.01
        OR ABS(COALESCE(po."total_amount", 0) - t.new_total) >= 0.01 );

-- ── 2) Recalcular payment_status desde el ledger canonico purchase_order_payments ──
--    Usa el total_amount ya normalizado arriba. Excluye NaN y OCs cancelled.
UPDATE "purchase_orders" po
SET "payment_status" = c.new_status,
    "updated_at"     = CURRENT_TIMESTAMP
FROM (
  SELECT po.id,
    (CASE
       WHEN COALESCE(p.total_paid, 0) >= po."total_amount" - 0.005 AND po."total_amount" > 0.005 THEN 'paid'
       WHEN COALESCE(p.total_paid, 0) > 0.005 THEN 'partial'
       ELSE 'unpaid'
     END)::"purchase_order_payment_status_enum" AS new_status
  FROM "purchase_orders" po
  LEFT JOIN (
    SELECT "purchase_order_id" AS po_id,
           COALESCE(SUM("amount") FILTER (WHERE "amount"::text <> 'NaN'), 0) AS total_paid
    FROM "purchase_order_payments"
    GROUP BY "purchase_order_id"
  ) p ON p.po_id = po.id
  WHERE po."status"::text <> 'cancelled'
) c
WHERE c.id = po.id
  AND po."payment_status" <> c.new_status;

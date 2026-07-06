-- =====================================================
-- backfill_stock_cost_per_unit
-- =====================================================
-- DATA IMPACT:
-- Tables affected:       stock_levels
-- Column affected:       cost_per_unit (Decimal(12,4), nullable, sin default)
-- Condition:             SOLO filas con cost_per_unit IS NULL OR = 0
-- Expected row changes:  BAJO. El modulo de compra de inventario casi no se
--                        uso productivamente en prod; el historico corrupto
--                        real es basicamente datos demo de tiendas demo.
-- Destructive ops:       NINGUNA. Solo backfill de una columna. Nunca borra
--                        filas ni sobreescribe un costo ya sano (guardado por
--                        el WHERE cost_per_unit IS NULL OR = 0).
-- FK/cascade risk:       NINGUNO. No toca constraints, llaves ni CASCADE.
-- Idempotency:           Garantizada por WHERE (cost_per_unit IS NULL OR = 0).
--                        Re-ejecutar la migracion NO vuelve a tocar filas ya
--                        saneadas (su costo deja de ser NULL/0).
-- Fuente de verdad:      inventory_cost_layers (PRIMARIA). Donde no hay capas,
--                        cae a product_variants.cost_price / products.cost_price
--                        (FALLBACK). Misma cadena canonica que
--                        CostingService.initializeCostLayers.
-- Approval:              Documentado en scripts/RUNBOOK-backfill-cost-price.md
--                        + chat/PR. Requiere snapshot RDS previo (ver runbook).
-- =====================================================

-- 1) FUENTE PRIMARIA — promedio ponderado (WAC) de las capas de costo vivas
--    (quantity_remaining > 0 y unit_cost > 0) por product/variant/location.
--    IS NOT DISTINCT FROM casa correctamente el product_variant_id NULLable
--    (producto simple sin variante) sin caer en la trampa de NULL = NULL.
UPDATE stock_levels sl
SET cost_per_unit = sub.wac
FROM (
  SELECT
    product_id,
    product_variant_id,
    location_id,
    SUM(quantity_remaining * unit_cost) / NULLIF(SUM(quantity_remaining), 0) AS wac
  FROM inventory_cost_layers
  WHERE quantity_remaining > 0
    AND unit_cost > 0
  GROUP BY product_id, product_variant_id, location_id
) sub
WHERE (sl.cost_per_unit IS NULL OR sl.cost_per_unit = 0)
  AND sl.product_id = sub.product_id
  AND sl.location_id = sub.location_id
  AND sl.product_variant_id IS NOT DISTINCT FROM sub.product_variant_id
  AND sub.wac IS NOT NULL
  AND sub.wac > 0;

-- 2) FALLBACK — filas todavia sin costo (sin capas vivas) se saldan con el
--    cost_price de la variante, si no, del producto. NULLIF descarta ceros
--    espurios en cascada (variante 0 -> producto -> se ignora si tambien 0).
--    NOTA: Postgres NO permite referenciar la tabla objetivo (sl) dentro del
--    ON de un JOIN en el FROM. Por eso `products` va como join correlacionado
--    en el WHERE (permitido) y la variante como subconsulta escalar
--    correlacionada (pv.id y p.id son PKs -> a lo sumo una fila). Con
--    product_variant_id NULL la subconsulta no devuelve fila -> cae al producto.
UPDATE stock_levels sl
SET cost_per_unit = COALESCE(
  NULLIF((SELECT pv.cost_price FROM product_variants pv WHERE pv.id = sl.product_variant_id), 0),
  NULLIF(p.cost_price, 0)
)
FROM products p
WHERE p.id = sl.product_id
  AND (sl.cost_per_unit IS NULL OR sl.cost_per_unit = 0)
  AND COALESCE(
    NULLIF((SELECT pv.cost_price FROM product_variants pv WHERE pv.id = sl.product_variant_id), 0),
    NULLIF(p.cost_price, 0)
  ) > 0;

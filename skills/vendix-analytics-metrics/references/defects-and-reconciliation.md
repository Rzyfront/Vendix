# Analytics — catálogo de defectos medidos y consultas de reconciliación

## Catálogo de defectos medidos (agosto 2026)

Todos verificados contra datos reales, no inferidos. Sirven de test de regresión.

| # | Defecto | Síntoma que ve el usuario | Fix |
|---|---|---|---|
| C1 | `net_profit = ingresos − gastos`, sin COGS | "Vendí un reloj en 20.000 y dice que gané 20.000" | Cadena completa (regla 3) |
| C2 | `COALESCE(cost_price,0)` sin cobertura | Margen 100 % silencioso. Medido: 116/449 líneas sin snapshot | `CostCoverage` (regla 5) |
| C3 | 3 definiciones de ingreso en 3 endpoints (`grand_total` / `−tax` / `subtotal−desc`) | El panel y el Resumen no coinciden | `computeOperatingRevenue` (regla 1) |
| C4 | 2 juegos de estados de venta (`+refunded` solo en P&L) | Una orden reembolsada existe para uno y no para el otro | Contrato + razón explícita al derivar |
| C5 | 2 juegos de estados de gasto (`paid` vs `pending+approved+paid`) | Los Gastos del panel ≠ los del Resumen | `RECOGNIZED_EXPENSE_STATES` |
| C6 | `expense_date` (medianoche naive) contra ventana local | Gasto de hoy aparece ayer; el del día 1, el mes anterior. Medido: 5 registros, $1.046.000 | `resolveLocalDateOnlyRange` |
| C7 | Margen por producto con `products.cost_price` actual | Cambiar el costo reescribe la rentabilidad del año pasado | Snapshot (regla 6) |
| C8 | `prev > 0 ? … : 0` en 11 sitios | "0 %" cuando el período anterior estuvo vacío | `computeGrowth` (regla 9) |
| C9 | `"vs mes ant."` fijo | Dice "mes anterior" con el preset "Hoy" | Etiqueta derivada del preset |
| C10 | Caché sin `store_id` (`Map` de módulo, TTL 60 s) | Un admin multi-tienda ve cifras de la tienda anterior | Prefijo de scope (regla 10) |
| C11 | Subquery de COGS sin filtro de tienda | Full scan de `order_items` | Mismo filtro que la query padre |
| C12 | El frontend nunca manda `date_preset` | La semántica "hoy → hasta ahora" nunca se activa; crecimiento subestimado | Enviar el preset, o asumir día completo |
| C13 | 4 órdenes con `subtotal_amount` IVA-inclusivo | Esas filas cuentan IVA como ingreso | Dato viejo: reconciliar (ver consultas) |

## Consultas de reconciliación

```sql
-- 1. ¿Alguna fecha de negocio se corre de día al pasar por la TZ?
SELECT to_char(expense_date,'YYYY-MM-DD') AS real,
       to_char((expense_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'),'YYYY-MM-DD') AS visto,
       count(*), SUM(amount)
FROM expenses WHERE store_id = $1 GROUP BY 1,2 HAVING to_char(expense_date,'YYYY-MM-DD')
   <> to_char((expense_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'),'YYYY-MM-DD');

-- 2. Cobertura de costo del período (¿cuánto del margen es real?)
SELECT SUM(oi.quantity) AS unidades,
       SUM(CASE WHEN oi.cost_price IS NULL THEN oi.quantity ELSE 0 END) AS sin_costo
FROM order_items oi JOIN orders o ON o.id = oi.order_id
WHERE o.store_id = $1 AND o.state IN ('delivered','finished');

-- 3. Integridad del total de la orden (detecta subtotales IVA-inclusivos — C13)
SELECT count(*) FILTER (
  WHERE grand_total <> subtotal_amount - COALESCE(discount_amount,0)
                     + COALESCE(tax_amount,0) + COALESCE(shipping_cost,0)) AS descuadradas
FROM orders WHERE store_id = $1;
```


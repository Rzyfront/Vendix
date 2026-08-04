---
name: vendix-analytics-metrics
description: >
  Cómo nace bien una analítica de Vendix: una sola definición de ingreso/costo/gasto
  (analytics-metrics.contract.ts), el día de negocio en la TZ de la tienda distinguiendo
  TIMESTAMP de BUSINESS-DATE, COGS auditable con cobertura de costo, crecimiento sin base
  falsa, y caché con el scope de tienda en la llave. OBLIGATORIA al crear, editar, fixear o
  mejorar cualquier analítica, KPI, tarjeta de dashboard o serie temporal.
  Trigger: Working on apps/backend/src/domains/store/analytics, the store dashboard cards,
  or any frontend analytics page/chart/KPI.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating a new analytics endpoint, KPI, stat card or chart series"
    - "Editing, fixing or improving an existing analytics view or dashboard card"
    - "Computing revenue, COGS, gross/net profit, margin or break-even"
    - "Deciding which order or expense states count for a period"
    - "Querying analytics by date range or bucketing a time series"
    - "Debugging a metric that disagrees between two screens"
    - "Debugging records that appear one day or one month off in analytics"
    - "Debugging a profit or margin that looks too high"
    - "Working with analytics-metrics.contract.ts, COMPLETED_SALE_STATES or RECOGNIZED_EXPENSE_STATES"
    - "Working with resolveLocalDateOnlyRange, dateOnlyPeriodSql or CostCoverage"
    - "Adding or changing a frontend analytics cache key"
    - "Running npm run tz:audit or fixing one of its 7 rules"
---

# Vendix Analytics Metrics

Regla de oro: **una analítica no es un query, es un contrato.** Dos pantallas que dicen
"Ingresos" tienen que mostrar el mismo número, o una de las dos está mintiendo.

La infraestructura de zona horaria ya tiene dueño único (`vendix-date-timezone`). Esta skill
gobierna la otra mitad —**qué se suma**— que es de donde salieron todos los defectos medidos.

## Source of Truth

**Contrato de métricas** — `apps/backend/src/domains/store/analytics/analytics-metrics.contract.ts`
- `COMPLETED_SALE_STATES` = `['delivered','finished']` — venta consumada.
- `RECOGNIZED_EXPENSE_STATES` = `['approved','paid']` — gasto causado (`pending` NO es gasto).
- `computeOperatingRevenue({subtotal, discounts, shipping, tax})` = `subtotal − discounts + shipping`.
- `buildCostCoverage(unitsTotal, unitsWithoutCost)` → `CostCoverage`.
- `computeGrowth(current, previous)` → `number | null` (`null` = sin base).
- `round2(value)` — política ÚNICA de redondeo.
- `sqlStateList(states)` — lista de estados para `IN (...)` en `$queryRaw`, derivada del contrato.

**Fechas** — `apps/backend/src/common/utils/store-timezone.util.ts`
- `resolveStoreTimezone(prisma, storeId)` — fallback `America/Bogota`.
- `resolveLocalDateRange(query, tz)` / `parseDateRange(query, tz)` — para columnas **TIMESTAMP**.
- `resolveLocalDateOnlyRange(query, tz)` — para columnas **BUSINESS-DATE**.
- `localPeriodSql(col, tz, gran)` — bucket de un TIMESTAMP.
- `dateOnlyPeriodSql(col, gran)` — bucket de una BUSINESS-DATE (sin `AT TIME ZONE`).

**Guardia CI** — `npm run tz:audit` (7 reglas, job "TZ Audit").

**Referencias vivas** — `overview-analytics.service.ts` y `financial-analytics.service.ts` son
los dos servicios ya migrados: cópialos, no inventes.

## Reglas duras (INVIOLABLES)

1. **Ingreso = `computeOperatingRevenue`.** Nunca `SUM(grand_total)`: el IVA es pasivo con la
   DIAN, no ingreso. El IVA se reporta aparte (`tax_collected` / `total_taxes`).
2. **Un solo denominador.** El monto en pantalla y el `%` debajo se calculan sobre la MISMA base.
3. **La ganancia resta el COGS.** Cadena obligatoria: `ingreso → −COGS = bruta → −gastos = neta`.
   La neta nunca puede quedar por encima de la bruta.
4. **COGS en SQL, por línea.** `SUM(quantity * COALESCE(cost_price, 0))`. `SUM(a)*SUM(b) ≠ SUM(a*b)`.
5. **COGS viaja con su cobertura.** Todo endpoint que emita COGS emite `units_without_cost`
   (`CostCoverage`), y la UI advierte cuando `> 0`. Regla 7 de `tz:audit`.
6. **Costo histórico, no de catálogo.** El costo de una venta es `order_items.cost_price`
   (snapshot), nunca `products.cost_price` actual — eso reescribe el pasado.
7. **Clasifica cada columna de fecha.** TIMESTAMP → `parseDateRange`; BUSINESS-DATE →
   `resolveLocalDateOnlyRange` + `dateOnlyPeriodSql`. La línea lo declara con
   `tz-audit:date-only` o `tz-audit:ignore`. Regla 6 de `tz:audit`.
8. **Estados desde el contrato.** Ni en Prisma ni en `$queryRaw` se re-escribe la lista de
   estados a mano. En raw: `sqlStateList(...)`.
9. **Crecimiento sin base = `null`.** `previous === 0` → `null`, y la UI dice "sin base de
   comparación". Nunca `0 %`.
10. **La llave de caché lleva el scope de tienda.** El backend resuelve el tenant por sesión,
    así que la URL NO identifica de quién son los números.
11. **`$queryRaw` filtra por `store_id`** en la query Y en cada subquery, siempre pre-agregando
    `order_items` por `order_id` (nunca JOIN plano: multiplica la fila-orden). Regla 4.

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

## Flujo paso a paso

Para **crear, editar, mejorar o arreglar** cualquier analítica:

1. **Declara la métrica antes de escribir SQL.** Nombre, fórmula exacta, estados que cuentan,
   y de qué columna sale cada término. Si la fórmula no existe en el contrato, se añade AHÍ
   primero — no en el servicio.
2. **Clasifica cada columna de fecha** que entre en la ventana: ¿instante o business-date?
   Compruébalo en la DB, no en el schema (`@db.Timestamp` no distingue los dos):
   ```sql
   SELECT expense_date FROM expenses ORDER BY id DESC LIMIT 5;  -- 00:00:00 ⇒ business-date
   ```
3. **Resuelve la TZ una vez** (`resolveStoreTimezone`) y deriva de ahí TODAS las ventanas.
   Un servicio puede necesitar DOS ventanas (timestamps + business-dates): eso es correcto.
4. **Escribe el agregado** con estados del contrato, `store_id` en cada subquery, `order_items`
   pre-agregado por `order_id`, y COGS multiplicado por línea.
5. **Emite crudo y auditable**: números sin formatear, `round2` solo en la salida, `CostCoverage`
   junto al COGS, crecimiento `number | null`.
6. **Cablea el frontend**: la tarjeta lee el MISMO endpoint que su `%`; la llave de caché lleva
   el scope; la etiqueta de comparación se deriva del preset; el aviso de cobertura se muestra
   cuando `units_without_cost > 0`.
7. **Verifica con datos, no con la pantalla**: corre las consultas de reconciliación, `npm run tz:audit`,
   `npm run buildcheck`, y compara los dos períodos frontera (día 1 del mes y 23:00 local).

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

## Checklist "nace bien"

- [ ] La fórmula vive en `analytics-metrics.contract.ts`, no en el servicio.
- [ ] Ingreso vía `computeOperatingRevenue`; nunca `grand_total`.
- [ ] Monto y `%` sobre la misma base.
- [ ] Ganancia neta ≤ bruta, con COGS restado.
- [ ] `units_without_cost` emitido y advertido en la UI.
- [ ] Costo desde `order_items.cost_price`, no del catálogo.
- [ ] Cada `*_date` clasificado en su línea (`tz-audit:date-only` / `tz-audit:ignore`).
- [ ] Estados desde el contrato (`sqlStateList` en raw).
- [ ] Crecimiento `null` sin base; UI lo dice.
- [ ] Llave de caché con scope de tienda (backend y frontend).
- [ ] `store_id` en query y subqueries; `order_items` pre-agregado.
- [ ] `npm run tz:audit` y `npm run buildcheck` en verde.
- [ ] Consultas de reconciliación corridas sobre datos reales.

## Anti-patrones (rechazar en review)

- `_sum: { grand_total: true }` para "ingresos".
- `net_profit = ingresos − gastos` (sin COGS), o un breakeven que ignora el costo de mercancía.
- `COALESCE(cost_price, 0)` sin `units_without_cost`.
- `products.cost_price` para el margen de una venta pasada.
- `expense_date: { gte: startDate }` con la ventana de `parseDateRange`.
- `localPeriodSql('e.expense_date', ...)` — doble conversión de algo ya local.
- `IN ('delivered','finished')` escrito a mano en un servicio.
- `previous > 0 ? growth : 0`.
- Llave de caché sin tienda, o `invalidateCache(storeId)` contra una llave que no contiene `storeId`.
- Dos endpoints distintos alimentando el monto y su porcentaje en la misma tarjeta.

## Related Skills

- `vendix-date-timezone` - dueño de la TZ y del día de negocio; esta skill añade el contrato de la métrica.
- `vendix-report-xlsx` - misma disciplina aplicada a la exportación (pantalla == archivo).
- `vendix-inventory-valuation` - de dónde sale el costo (CPP/FIFO) que alimenta el COGS.
- `vendix-accounting-rules` - causación vs caja para gastos y asientos.
- `vendix-frontend-stats-cards` - la tarjeta que muestra el número.
- `vendix-frontend-cache` - patrón de caché del frontend.
- `buildcheck-dev` - puerta de compilación.

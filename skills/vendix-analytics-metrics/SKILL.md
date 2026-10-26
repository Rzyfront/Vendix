---
name: vendix-analytics-metrics
description: >
  OBLIGATORIA en analíticas: contrato único ingreso/costo/gasto, día de negocio en TZ de tienda, COGS
  auditable, crecimiento sin base falsa, caché por tienda. Trigger: crear/editar/fixear KPI,
  dashboard, serie temporal, domains/store/analytics.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
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

Regla de oro: **una analítica no es un query, es un contrato.** Dos pantallas que dicen "Ingresos" muestran el mismo número o una miente. La TZ tiene dueño propio (`vendix-date-timezone`); esta skill gobierna **qué se suma**.

## Source of Truth

- **Contrato** `apps/backend/src/domains/store/analytics/analytics-metrics.contract.ts` (léelo antes de sumar nada):
  - Estados: `COMPLETED_SALE_STATES` (`delivered`, `finished`), `REVENUE_STATES` (+`refunded`, solo con razón explícita: impuestos/reembolsos), `REFUND_RECOGNIZED_STATES`, `RECOGNIZED_EXPENSE_STATES` (`approved`, `paid`; `pending` NO es gasto), `PURCHASE_COMMITTED_STATES`, estados de caja, despacho y tipos de movimiento.
  - `computeOperatingRevenue({subtotal, discounts, shipping, shipping_tax, tax})` = `subtotal − discounts + (shipping − shipping_tax)`; en SQL, `OPERATING_REVENUE_SQL` (misma fórmula). Pasa siempre `shipping_tax`.
  - `buildCostCoverage`, `computeGrowth` (`null` = sin base), `round2` (redondeo único), `sqlStateList` (estados para `$queryRaw`), helpers de producto, IVA y despacho.
- **Fechas** `apps/backend/src/common/utils/store-timezone.util.ts`: `resolveStoreTimezone` (fallback `America/Bogota`), `resolveLocalDateRange` / `parseDateRange` (`analytics/utils/date.util.ts`) para **TIMESTAMP**, `resolveLocalDateOnlyRange` para **BUSINESS-DATE**, `localPeriodSql` / `dateOnlyPeriodSql` para buckets.
- **Guardia CI** `npm run tz:audit` (7 reglas, job "TZ Audit").
- **Referencias vivas** `services/overview-analytics.service.ts` y `services/financial-analytics.service.ts`: cópialos.

## Reglas duras (INVIOLABLES)

1. **Ingreso = `computeOperatingRevenue` / `OPERATING_REVENUE_SQL`.** Nunca `SUM(grand_total)`: el IVA (incluido el del flete) es pasivo con la DIAN; se reporta aparte (`tax_collected`).
2. **Un solo denominador**: monto y `%` sobre la MISMA base y el mismo endpoint.
3. **Ganancia: `ingreso → −COGS = bruta → −gastos = neta`.** La neta nunca supera a la bruta.
4. **COGS en SQL por línea**: `SUM(quantity * COALESCE(cost_price, 0))`; `SUM(a)*SUM(b) ≠ SUM(a*b)`.
5. **COGS viaja con su cobertura**: todo endpoint con COGS emite `units_without_cost` (`CostCoverage`) y la UI advierte si `> 0` (regla 7 de `tz:audit`).
6. **Costo histórico**: `order_items.cost_price` (snapshot), nunca `products.cost_price` actual.
7. **Clasifica cada columna de fecha**: TIMESTAMP → `parseDateRange`; BUSINESS-DATE → `resolveLocalDateOnlyRange` + `dateOnlyPeriodSql`; márcala con `tz-audit:date-only` o `tz-audit:ignore` (regla 6). Compruébalo en la DB (`00:00:00` ⇒ business-date), no en el schema.
8. **Estados desde el contrato**, nunca a mano (en raw: `sqlStateList`). Una fórmula nueva se añade primero al contrato.
9. **Crecimiento sin base = `null`** y la UI dice "sin base de comparación"; nunca `0 %`. La etiqueta de comparación se deriva del preset.
10. **La llave de caché lleva el scope de tienda** (backend y frontend): la URL no identifica al tenant.
11. **`$queryRaw` filtra `store_id`** en la query y en cada subquery, con `order_items` pre-agregado por `order_id` (JOIN plano multiplica filas; regla 4).

## Flujo

1. Declara la métrica (nombre, fórmula, estados, columna de cada término) antes del SQL.
2. Clasifica las fechas; resuelve la TZ una vez y deriva todas las ventanas (puede haber dos: timestamps y business-dates).
3. Escribe el agregado con las reglas 4, 8 y 11; emite números crudos (`round2` solo a la salida), `CostCoverage` y crecimiento `number | null`.
4. Cablea el frontend: tarjeta y `%` del mismo endpoint, caché con scope, aviso de cobertura.
5. Verifica con datos: consultas de reconciliación, `npm run tz:audit` y los períodos frontera (día 1 del mes, 23:00 local). Compilación en CI.

Catálogo de defectos medidos (C1–C13, sirven de regresión) y consultas SQL de reconciliación: `references/defects-and-reconciliation.md` (leer bajo demanda).

## Anti-patrones (rechazar en review)

`_sum: { grand_total: true }` como ingreso · `net_profit = ingresos − gastos` o breakeven sin COGS · `COALESCE(cost_price, 0)` sin `units_without_cost` · `products.cost_price` para ventas pasadas · `expense_date` con la ventana de `parseDateRange` · `localPeriodSql` sobre una business-date · estados escritos a mano · `previous > 0 ? growth : 0` · caché sin tienda o `invalidateCache(storeId)` contra una llave sin `storeId` · dos endpoints para el monto y su `%`.

## Related Skills

`vendix-date-timezone`, `vendix-report-xlsx` (pantalla == archivo), `vendix-inventory-valuation` (origen del costo), `vendix-accounting-rules` (causación vs caja), `vendix-frontend-stats-cards`, `vendix-frontend`.

---
name: vendix-report-xlsx
description: >
  Cómo nacen bien los reportes descargables de Vendix: exportación XLSX profesional con
  ExcelJS (nunca CSV), fechas en la timezone de la tienda (fallback SIEMPRE America/Bogota),
  dataset completo, agregación única (pantalla == archivo), y flujo de export unificado
  backend→frontend. OBLIGATORIA al crear, editar, fixear o mejorar cualquier reporte.
  Trigger: Creating, editing, fixing or improving any downloadable/report/export feature
  in apps/backend/src/domains/store/analytics or apps/frontend .../store/reports.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating a new downloadable report (backend export endpoint + frontend registry entry)"
    - "Editing, fixing or improving an existing report"
    - "Generating an XLSX file from a backend service"
    - "Adding or changing report columns, headers, number formats or totals"
    - "Adding an exportEndpoint to the report registry"
    - "Fixing report dates, timezone, formatting or wrong/incomplete data"
    - "Working with ReportBuilder, buildReportBuffer, sendXlsxReport or buildReportFilename"
    - "Working with the reports export flow (exportReport action, exportReport$ effect, exportFromBackend)"
    - "Working with ReportDataAdapterService (summary/list/nested adaptation)"
---

# Vendix Report XLSX

Regla de oro: **un reporte nace profesional, correcto y seguro, o no nace.** Esta skill es
obligatoria para crear/editar/fixear/mejorar cualquier reporte descargable.

## Source of Truth

**Backend (motor compartido):**
- `apps/backend/src/common/reports/report-builder.ts` — `buildReportBuffer(input)`, clase `ReportBuilder`, `formatCellDate(utc, tz)`.
- `apps/backend/src/common/reports/report-column.types.ts` — `ReportColumn`, `ReportSheet`, `ReportWorkbookInput`.
- `apps/backend/src/common/reports/report-response.util.ts` — `sendXlsxReport(res, buffer, filename)`, `buildReportFilename(base, {date?, tz?})`, `XLSX_CONTENT_TYPE`.
- `apps/backend/src/common/utils/store-timezone.util.ts` — `resolveStoreTimezone(prisma, storeId)` (columna-primero), `DEFAULT_STORE_TIMEZONE = 'America/Bogota'`, `resolveLocalDateRange`.
- `apps/backend/src/domains/store/analytics/utils/date.util.ts` — `parseDateRange(query, tz)`.
- `apps/backend/src/domains/store/analytics/dto/*` — DTOs de query que extienden `BaseReportQueryDto`.
- `apps/backend/src/domains/store/analytics/analytics.controller.ts` — patrón de referencia: `resolveReportTz()`, `toSheet()`, `emitReport()`.

**Frontend (flujo único de export):**
- `apps/frontend/src/app/private/modules/store/reports/config/report-registry.ts` — catálogo de reportes.
- `apps/frontend/.../reports/interfaces/report.interface.ts` — `ReportDefinition`, `ReportColumn` (con `footer`).
- `apps/frontend/.../reports/state/reports.effects.ts` — `exportReport$` (único camino de export).
- `apps/frontend/.../reports/services/reports-data.service.ts` — `exportFromBackend(endpoint, dateRange)`.
- `apps/frontend/.../reports/services/report-export.service.ts` — `downloadBlob(blob, filename)`.
- `apps/frontend/.../reports/services/report-data-adapter.service.ts` — adaptación summary/list/nested (footer-aware).
- `apps/frontend/.../reports/components/report-viewer/report-viewer.component.ts` — botón export condicional.

## Reglas duras (INVIOLABLES)

1. **XLSX, nunca CSV.** Toda descarga se genera con `ReportBuilder` (ExcelJS) en el backend. Prohibido generar CSV o usar SheetJS (`xlsx`) en el frontend. El frontend solo descarga el blob que produce el backend.
2. **Fechas en la timezone de la tienda.** Cada tienda usa su `stores.timezone`; el fallback es **SIEMPRE `America/Bogota`** (`DEFAULT_STORE_TIMEZONE`). Resuelve con `resolveStoreTimezone(prisma, storeId)` (columna-primero). Nunca uses `new Date().toISOString()` para fechas de negocio ni fechas en UTC crudo.
3. **Los servicios devuelven datos CRUDOS.** Un servicio de export retorna instantes `Date` y números/`Decimal` sin formatear. El formato (headers, `numFmt`, tipo de celda, TZ) vive en el catálogo de columnas / `ReportBuilder`. Nunca `.toISOString().split('T')[0]` ni `$` hardcodeado en el servicio.
4. **Dataset completo, no la página visible.** El export trae TODO el rango (con un tope explícito, p.ej. `take: 10000`, y si truncas, dócumentalo). Nunca exportes solo la página paginada de la pantalla.
5. **Agregación única: pantalla == archivo.** Los totales/subtotales del archivo se calculan con la MISMA fuente que la pantalla. Nunca dos sumas divergentes.
6. **Seguridad y scope.** El endpoint respeta el store context (`RequestContextService`), scope multi-tenant y permisos. Un reporte jamás cruza datos de otra tienda/organización.

## Backend: crear un export XLSX

```ts
// controller
async exportVentas(@Query() query: SalesReportQueryDto, @Res() res: Response): Promise<void> {
  const tz = await this.resolveReportTz();                 // store TZ, fallback America/Bogota
  const rows = await this.salesService.getSalesForExport(query); // RAW: Date + números
  const sheet = this.toSheet('Ventas', [
    { key: 'created_at', header: 'Fecha',   type: 'date',     tz },
    { key: 'order_code', header: 'Orden',   type: 'text' },
    { key: 'total',      header: 'Total',   type: 'currency' },
    { key: 'margin',     header: 'Margen',  type: 'percent' }, // percent = fracción (0.15 = 15%)
  ], rows, tz);
  await this.emitReport(res, 'reporte_ventas', tz, [sheet]);
}
```

- `type`: `'text' | 'number' | 'currency' | 'date' | 'percent'`. `percent` recibe **fracción** (0.15 → 15 %), no 15.
- `buildReportFilename(base, { date, tz })` añade el sufijo de fecha **local de la tienda**.
- `sendXlsxReport(res, buffer, filename)` setea Content-Type + Content-Disposition y cierra la respuesta. Usa `@Res() res` (sin passthrough) y retorna `Promise<void>`.
- El DTO de query extiende `BaseReportQueryDto` (`date_from`/`date_to` = `YYYY-MM-DD` en TZ tienda; el rango lo resuelve `parseDateRange(query, tz)`).

## Frontend: registrar y exportar

1. **Registry** (`report-registry.ts`): añade/edita la entrada con `exportEndpoint` apuntando al endpoint backend, `columns` (con `type` y `footer` cuando aplique: `'sum' | 'average' | 'count'`), y `exportFilename`.
2. **Flujo único**: la página despacha `this.store.dispatch(ReportsActions.exportReport())`. El effect `exportReport$` llama `exportFromBackend(exportEndpoint, dateRange)` y descarga con `downloadBlob`. **No** generes archivos en el cliente.
3. **Botón condicional**: `report-viewer` solo muestra el botón export cuando el reporte declara `exportEndpoint`. Un reporte sin backend export **no** muestra botón (nada de export roto/parcial).
4. **Adapter footer-aware**: `computeSummaryFromRows` solo agrega columnas con `footer` declarado (`sum`/`average`/`count`), nunca suma a ciegas (evita "suma de IDs / precios / %").

## Checklist "nace bien"

- [ ] Export en backend con `ReportBuilder` (XLSX), no CSV/SheetJS.
- [ ] TZ resuelta con `resolveStoreTimezone` (fallback `America/Bogota`); celdas `date` con `tz`.
- [ ] Servicio devuelve `Date` + números crudos; presentación en columnas.
- [ ] Dataset completo (tope documentado si trunca).
- [ ] Totales del archivo = misma fuente que pantalla.
- [ ] Endpoint scoped por tienda + permisos.
- [ ] Registry con `exportEndpoint`, `columns.type`, `footer`.
- [ ] Página despacha `exportReport`; sin CSV cliente.
- [ ] Botón export oculto si no hay `exportEndpoint`.
- [ ] `npm run build:prod` del frontend en verde.

## Anti-patrones (rechazar en review)

- Generar CSV/XLSX en el frontend (`XLSX.writeFile`, `new Blob([csv])`).
- `new Date().toISOString().split('T')[0]` para fechas de negocio o nombres de archivo.
- Exportar `this.data()` paginado de la pantalla en vez del dataset completo.
- Sumar todo campo numérico sin respetar `footer`.
- Formatear moneda/fecha dentro del servicio backend.
- Botón export visible en un reporte sin `exportEndpoint`.

# Print geometry — esquema y consumidores

## Esquema y validación

- `PF/schemas/definition-v2.schema.json`: `paper.printable_width_mm` opcional (42–76).
- `PF/schemas/ajv-instance.ts`: `checkPrintableWidthRange` (invariante de rango).
- Vista previa devuelve `printable_width_mm` / `content_width_mm`; un `/paper` inválido responde 400 `PRINT_CONFIG_VALIDATION_001`.
- Escritura saneada en `services/print-formats.service.ts`: en rollo se quita `orientation` y `is_roll` se deriva de `format`.

(PF = `apps/backend/src/domains/store/print-formats`)

## Dónde aplica (consumidores)

| Consumidor | Ruta |
|---|---|
| Composer HTML | `PF/services/print-layout-composer.service.ts` — `wrapInHtmlDocument`, `resolveDocumentGeometry` (maneja `custom` legado); guardas CSS: `table-layout: fixed`, `overflow-wrap`, QR `min(210px,100%)` |
| PDF térmico de factura | `apps/backend/src/domains/store/invoicing/services/invoice-pdf.builder.ts` |
| PDF de planilla de ruta | `apps/backend/src/domains/store/dispatch-routes/route-flow/pdf-export.service.ts` |
| Frontend (cuerpos locales y lotes) | `apps/frontend/src/app/shared/services/print/document-print.service.ts` — `resolveConfig`, wrapper `.vx-print-root`, `withGatewayPrintGuard` (idempotente vía `data-vx-print-guard`) |
| Editor | `.../store/settings/print-formats/` — no escribir margen 0 al elegir rollo; franja imprimible en vista previa; ticket de calibración (`paper-calibration.ts`) |

Las plantillas locales de rollo (`pos-ticket.service.ts`, cierre de caja, precuenta, etc.) **no fijan anchos**: heredan el del wrapper.

---
name: vendix-print-geometry
description: >
  Regla del "ancho imprimible" para documentos impresos de Vendix (QUI-950): todo ticket en rollo
  se arma al ancho imprimible del cabezal, nunca al ancho del papel. Cubre la fuente única
  `printable_width_mm`, el kernel `resolvePrintGeometry`, y los consumidores (composer, PDF de
  factura, PDF de planilla, DocumentPrintService).
  Trigger: Editing print formats, print templates, thermal ticket layout or paper geometry; adding a
  print route or PDF builder for rolls; debugging a ticket cut at the sides.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Editing print formats, print templates, thermal ticket layout or paper geometry"
    - "Adding a new print route or PDF builder for rolls"
    - "Debugging a ticket cut at the sides"
    - "Adding a new paper format to print formats"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Print Geometry

## Purpose

Un cabezal térmico no imprime todo el ancho del papel: rollo 80 mm imprime ~72 mm (algunos 64 mm / 512 puntos) y rollo 58 mm ~48 mm. Si el contenido se arma a `papel − 2×1,5 mm` (≈77 mm) los laterales salen cortados ("LIENTE", "$59.0("). Esta skill fija la regla que lo impide por construcción. Origen: QUI-950, plan `docs/plans/2026-10-14-thermal-printable-width.md`. La regresión visible la causó `0e4779718`, que quitó un padding de 4 px que compensaba por casualidad.

## Critical Rules

1. **Se maqueta al ancho imprimible, nunca al ancho del papel.** `width_mm` es el papel; el contenido mide `content_width_mm <= printable_width_mm`.
2. **Una sola fuente:** `printable_width_mm` en `libs/print-formats/schemas/geometry-data.ts` (thermal_80 = 72, thermal_58 = 48, a4 = 200, letter/half_letter = 206). Se copia byte a byte con `scripts/sync-print-geometry.ts` a:
   - `apps/backend/src/domains/store/print-formats/lib/geometry-data.ts`
   - `apps/frontend/src/app/core/lib/geometry-data.ts`
   La copia de `apps/mobile` está congelada (app Expo deprecada): no se sincroniza.
3. **Nadie calcula geometría por su cuenta:** todo pasa por el kernel `resolvePrintGeometry(paper)`.
4. **El clamp ocurre al renderizar**, no se migran filas guardadas (regla 6 de migraciones: no mutar datos de negocio). Prod tiene márgenes 0 y 1,5 mm guardados; el kernel los neutraliza.
5. Impresión sin diálogo (`--kiosk-printing`, agente local) está fuera de alcance: ticket QUI-951.

## Kernel

`apps/backend/src/domains/store/print-formats/lib/print-geometry.ts` — `resolvePrintGeometry(paper)` pura. Espejo idéntico en lógica: `apps/frontend/src/app/core/lib/print-geometry.ts` (solo difiere `lookupPaper`; cualquier cambio va en AMBOS). Spec: `lib/__tests__/print-geometry.spec.ts`.

Devuelve `{ is_roll, format, page_size, margins{top,right,bottom,left}, paper_width_mm, printable_width_mm, content_width_mm }`.

Reglas:
- Rollo: `printable` se acota a `[w−16, w−4]` (80 mm: 64..76; 58 mm: 42..54).
- Rollo: margen lateral = `max(guardado, (w − printable)/2)`; margen por defecto 1,5 mm.
- Hoja: margen por defecto 10 mm, mínimo 5 mm por lado.
- Tolera margen 0/ausente, `landscape`, `is_roll` incoherente con `format`, formato desconocido.
- Los builders pdfkit usan un helper local `rollMarginPt` (en `invoice-pdf.builder.ts` y `dispatch-routes/route-flow/pdf-export.service.ts`) derivado de esa geometría.

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

## Checklist: nuevo formato de papel

1. Agregar el formato en `libs/print-formats/schemas/geometry-data.ts` con `printable_width_mm`.
2. Correr `scripts/sync-print-geometry.ts` (no editar las copias a mano).
3. Agregar la definición en `PF/print-templates/paper-definitions.ts` (`printable_width_mm`).
4. Verificar rango en el schema y `checkPrintableWidthRange` si cambia el rango válido.
5. Extender la matriz de `print-geometry.spec.ts` (margen 0 / 1,5 / ausente, landscape, `is_roll` incoherente).
6. Correr el gate `page-geometry.spec.ts` (detecta copias desincronizadas).

## Checklist: nueva ruta de impresión o PDF builder para rollo

1. Obtener ancho de contenido y márgenes de `resolvePrintGeometry`; nunca de `width_mm`.
2. HTML: pasar por el composer / `DocumentPrintService`, sin `@page` propio ni anchos fijos.
3. pdfkit: tamaño de página = papel, márgenes laterales >= `(paper − printable)/2` (patrón `rollMarginPt`); contenido, QR y logo acotados a `content_width_mm`.
4. Texto inquebrantable (emails, nombres largos): ajustar (`overflow-wrap: anywhere`), no `overflow: hidden` (corta en silencio).
5. Probar con contenido hostil y en 58 mm.

## Anti-patrones

- Anchos fijos en plantillas de rollo (80mm, 302px, 75–85 mm).
- Margen 0 en rollo (editor o `@page margin 0` forzado en el frontend).
- Usar `width_mm` como ancho de contenido.
- Editar una copia de `geometry-data.ts` en vez del canónico + script de sync.
- Cambiar el kernel en un solo lado (backend o frontend).
- `overflow: hidden` o `transform: scale` para "arreglar" el desborde.
- Migración que reescribe márgenes de `print_templates` / `store_print_format_configs`.

## Tests

Desde `apps/backend` (de a un spec, `--runInBand`):

```bash
npx jest --runInBand src/domains/store/print-formats/lib/__tests__/print-geometry.spec.ts
npx jest --runInBand src/domains/store/print-formats/__tests__/page-geometry.spec.ts
npx jest --runInBand src/domains/store/print-formats/services/__tests__/print-layout-composer.v2.spec.ts
```

## Related Skills

- `vendix-known-errors` — entrada "ticket térmico se corta en los laterales"
- `vendix-settings-system` — configuración por tienda
- `vendix-dispatch-routes` — PDF de planilla
- `vendix-date-timezone` — fechas en impresos
- `vendix-prisma-migrations` — por qué no se migran márgenes guardados

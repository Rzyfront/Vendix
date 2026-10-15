# Validación cambio de titular CF — 2026-10-15

**Estado: integración y validación parcial. NO 100% del plan, no release-ready.**
Rama `feat/cf-invoice-holder-change`, base `d8b0b2446`. Entrega en rama de feature para revisión; sin deploy ni merge. Ver SHA remoto en seguimiento de ejecución.

## Resultados observados

- Backend: 369 assertions PASS y 1 FAIL en 35 archivos, ejecutados individualmente y en serie.
- Frontend: 80 PASS en 7 archivos ChromeHeadless, sin watch y en serie. No equivalen a Playwright end-to-end.
- Total consolidado por último resultado de cada archivo: 449 PASS, 1 FAIL. Las reejecuciones no se suman. No incluye pruebas omitidas del baseline ni los chequeos raster QR.
- Única falla: `auto-entry.service.sale-recognition.spec.ts`, caso «refund que supera lo reversado por la NC». 35 PASS/1 FAIL. Se reprodujo el mismo fallo con la implementación HEAD anterior, cargada por mapper aislado. La comparación fue solo comportamiento (transpile-only para evitar duplicar el programa TS y exceder memoria); no constituye un typecheck del baseline. No se modificó lógica de refunds ajena al alcance.
- Prisma singleton audit y git diff --check PASS. No builds/typechecks independientes ni suites completas.
- Migración feature SQL aplicada DOS veces en `vendix_cf_holder_v2_20261015_test`, con esquema solamente, sin copiar filas de negocio. También se aplicó allí el prerrequisito de develop `20261014235000_invoice_client_request_id`. Esto NO es evidencia de migrate-deploy ni de migration-history productiva.
- Integración PostgreSQL real: 6 PASS de motor/locks/replay/checkpoint/lease/reserva/privacidad guest. No prueba creación de NC, envío/reemplazo aceptado ni journals con contabilidad activada: esas rutas no son el alcance del fixture.
- QR real generado y decodificado con ZXing instalado, a escalas nominales de 203 dpi. La prueba reveló fragilidad térmica a 110 pt; se amplió SOLO holder QR a 130 pt, clamp por ancho imprimible. Raster normal de térmicos 58/80, HTML y A4 decodifica. No equivale a escaneo físico ni extracción del PDF entregado.

## Correcciones de integración

Replay manual idéntico reutiliza saga; errores >=500 reintentables; CAS por versión/lease y fencing bajo locks antes de efectos; agotamiento tras 8 fallos transitorios a action_required; recuperación ordenada por vencimiento para evitar inanición por id. Snapshot fiscal incluye clasificación opcional congelada y no hereda clasificación CF en reemplazo. Captura admin tiene validación nested/whitelist y exige permiso crear cliente para snapshot. Anulación total compara economía por líneas/impuestos, no solo total de cabecera. Omit global guest permanece activo en runtime y se comprobó en PostgreSQL, incluyendo tx.

## Pendientes reales P19/P20

1. Matriz completa de carreras QR/manual/emisión normal/refund/split y fallos tras cada checkpoint, con motor fiscal completo y journals habilitados. Las 6 pruebas actuales NO cierran esa matriz.
2. Recorrido fiscal sandbox original accepted → NC accepted → unlink → cliente → reemplazo accepted → conciliación y recovery tras fallos. Metadatos locales: no hay config TEST simultáneamente enabled y con certificado; se pidió a Rafael identificar el sandbox. No se extrajeron claves ni se tocó producción.
3. API HTTP contra ESTA rama y Playwright vhost, desktop/narrow, red/consola. Herramienta Playwright MCP no disponible; backend Docker existente monta checkout principal, por lo que sus logs NO prueban esta rama. ChromeHeadless aquí es unitario/de componentes.
4. Escaneo de ambos QR físicos, descarga/getPdf/correo real y lectura de los artefactos entregados.
5. Canary/cutover/monitorización y habilitación gradual de P20 no ejecutados. Admisiones siguen desactivadas por defecto; runbook preparado. No aplicar producción ni mezclar este proyecto con release anterior. Push autorizado únicamente a la rama feature.

## Comandos reproducibles

Backend: `npm run test:path -w apps/backend -- <spec exacta>` (una por proceso).
Frontend: `NG_BUILD_MAX_WORKERS=2 npm exec -w apps/frontend -- ng test --watch=false --browsers=ChromeHeadless --ts-config=tsconfig.cf-holder.spec.json --include=<spec exacta>`.
Integración: suministrar `CF_HOLDER_TEST_DATABASE_URL` explícita; la spec solo admite loopback y nombre `vendix_cf_holder_*_test`, sin fallback a DATABASE_URL. Sin DELETE/reset/seed global.

## Revisión final y QR POS opt-in

- `show_holder_change_qr` se almacena en JSON del formato POS electrónico por tienda, ausente/false = desactivado. Checkbox, composer estándar/custom y PDF respetan la definición efectiva. No migra ni activa tiendas existentes. El QR DIAN no cambia; los bloques QR manuales tampoco se eliminan.
- Corregida copia de `shipping_amount` y `withholding_amount` en la NC espejo total. Regresión de creación comprueba hash económico completo y checkpoint atómico; liberación comprueba flete igual y rechazo ante flete perdido.
- La configuración contable viva ya no permite omitir un reconocimiento previamente existente. Una regresión apaga el área antes de replacement y exige su journal y efecto posted.
- La conciliación de ventas por pago resuelve mappings canónicos de los tributos del documento, incluido ICA 2412 y override por tienda, en lugar de hardcodear solo IVA/INC. Conserva comparación exacta y exclusión de propinas.
- Status legacy submitted/completed se resuelve sin exigir nuevas admisiones, manteniendo UUID, vigencia y tenant. Leer solicitud materializada no la modifica; nueva admisión/adopción para submit se revalida bajo lock y las guardas del motor permanecen.
- Regresiones finales: contabilidad 8 PASS, NC 12 PASS, liberación 5 PASS, enlaces 18 PASS, solicitudes 15 PASS, motor 9 PASS y PostgreSQL aislado 6 PASS. Estos resultados están incluidos en el total, no son adicionales.
- Prisma singleton audit y diff whitespace PASS después de las correcciones. Sin typecheck/build local ni CI de merge. El CI general se dispara en push develop o PR hacia develop/main; no se abrió PR bajo la orden de dejar únicamente la rama subida. El workflow separado de suites backend admite dispatch, pero no se ejecutó ni equivale a CI de merge.
- Revisión de código final abordó los cuatro hallazgos concretos anteriores; no es aprobación del deploy ni sustituye P19/P20.

## Último resultado por archivo (sin duplicar reejecuciones)

- `auto-entry.service.sale-recognition.spec.ts`: 35 PASS, 1 FAIL.
- `cf-holder-qr.spec.ts`: 4 PASS, 0 FAIL.
- `checkout-guest-access.spec.ts`: 4 PASS, 0 FAIL.
- `credit-notes.service.createnote.spec.ts`: 12 PASS, 0 FAIL.
- `ecommerce-invoice-data.controller.spec.ts`: 14 PASS, 0 FAIL.
- `fiscal-invoice-pdf-render.service.spec.ts`: 34 PASS, 0 FAIL.
- `guest-order-access.service.spec.ts`: 8 PASS, 0 FAIL.
- `holder-change-accounting.spec.ts`: 8 PASS, 0 FAIL.
- `holder-change-qr-policy.spec.ts`: 8 PASS, 0 FAIL.
- `holder-change-reservation.spec.ts`: 4 PASS, 0 FAIL.
- `invoice-data-request-submitted.listener.spec.ts`: 3 PASS, 0 FAIL.
- `invoice-data-requests.controller.spec.ts`: 3 PASS, 0 FAIL.
- `invoice-data-requests.service.spec.ts`: 15 PASS, 0 FAIL.
- `invoice-flow.holder-reconcile.spec.ts`: 4 PASS, 0 FAIL.
- `invoice-flow.service.spec.ts`: 45 PASS, 0 FAIL.
- `invoice-holder-change-recovery.service.spec.ts`: 6 PASS, 0 FAIL.
- `invoice-holder-change-release.spec.ts`: 5 PASS, 0 FAIL.
- `invoice-holder-changes.concurrent.integration.spec.ts`: 6 PASS, 0 FAIL.
- `invoice-holder-changes.controller.spec.ts`: 10 PASS, 0 FAIL.
- `invoice-holder-changes.schema.spec.ts`: 3 PASS, 0 FAIL.
- `invoice-holder-changes.service.spec.ts`: 9 PASS, 0 FAIL.
- `invoice-holder-link.service.spec.ts`: 18 PASS, 0 FAIL.
- `invoice-number-generator.spec.ts`: 16 PASS, 0 FAIL.
- `invoice-pdf.builder.cf-holder.spec.ts`: 3 PASS, 0 FAIL.
- `invoice-pdf.service.spec.ts`: 4 PASS, 0 FAIL.
- `invoicing.service.titular.spec.ts`: 7 PASS, 0 FAIL.
- `merge-definition.spec.ts`: 10 PASS, 0 FAIL.
- `order-reviews.service.spec.ts`: 10 PASS, 0 FAIL.
- `orders.service.history.spec.ts`: 4 PASS, 0 FAIL.
- `pos-fiscal-emission.service.spec.ts`: 30 PASS, 0 FAIL.
- `pos-holder-link.spec.ts`: 2 PASS, 0 FAIL.
- `pos-holder-qr-config.spec.ts`: 1 PASS, 0 FAIL.
- `print-gateway.engine-pdf.spec.ts`: 5 PASS, 0 FAIL.
- `print-layout-composer.cf-holder.spec.ts`: 9 PASS, 0 FAIL.
- `submit-invoice-data.dto.spec.ts`: 10 PASS, 0 FAIL.
- Frontend `customer-billing-fields.component.spec.ts`: 4 PASS.
- Frontend `customer-modal.component.spec.ts`: 12 PASS.
- Frontend `invoice-data-requests-page.component.spec.ts`: 3 PASS.
- Frontend `invoice-data.component.spec.ts`: 3 PASS.
- Frontend `invoice-holder-change.component.spec.ts`: 2 PASS.
- Frontend `order-details-page.component.spec.ts`: 54 PASS.
- Frontend `paper-panel.holder-qr.spec.ts`: 2 PASS.

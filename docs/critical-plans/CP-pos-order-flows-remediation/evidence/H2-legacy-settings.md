# H.2 Clave legada aceptada, pero inerte

Tienda QA local #10 tenía `settings.pos.tax_line_gate="block"`. Se capturó el JSON completo de settings antes y después. `PATCH /api/store/settings` con **sección POS completa, no solo la clave** respondió HTTP 200; `GET /api/store/settings` respondió HTTP 200 y conservó `tax_line_gate=block`. El JSON completo antes/después fue semánticamente idéntico (`jq -S`/`diff`), evitando la pérdida de otros ajustes que causaría un PATCH parcial (el servicio reemplaza la sección). Bajo ese mismo `block`, el POS mesa cobró el producto 302 sin asignación, HTTP 201/IVA 0 (`H3-ui-pos-table-taxless.*`).

`payments.service.spec.ts` prueba `block`, `warn`, `off` y ausencia: todas producen tax0 sin `order_item_taxes`, sin leer ajustes ni emitir el falso warning (suite 104/104). `rg` dio cero referencias a `taxLineGateSeverity` y `payments.pos_table_line_tax_unresolvable` en PaymentsService, cero controles frontend `tax_line_gate`, cero lanzadores de `POS_TABLE_LINE_TAX_UNRESOLVABLE_001`; el código queda reservado solo en el catálogo de errores. La clave permanece aceptada en DTO/interfaz, no en defaults nuevos.

Playwright real contra `https://vendix.com/admin/settings/general/venta` inspeccionó la sección «Punto de Venta (POS)»: no hay selector `block/warn/off` ni CTA «asignar impuesto» (`H2-settings-pos-no-tax-gate.png`).

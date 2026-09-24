# I.5 — paginación real de ventas descubiertas (>25)

QA local tienda #3, 2026-09-23. Se insertaron **27** eventos sintéticos temporales `pos_sale_without_fiscal_document` (IDs #406–432), uno por orden existente distinta, con `metadata.test_tag=QA-I5-PAGE-20260923`; no se emitió ni alteró documento fiscal. `invoice_retry_queue` tenía 2 filas antes y después.

- API autenticada `GET /store/fiscal/history?event_type=pos_sale_without_fiscal_document&page=1&limit=25` → 200, `meta.total=27`, 25 filas. Página 2 → 200, 2 filas (#431/#432); página 3 → 200, arreglo vacío. Ninguna fila ajena entró en la tienda #3.
- Playwright real en `vendix.com/admin/fiscal/audit`: tras cerrar «Tu semana en Vendix» y elegir **«Continuar en lectura»** del paywall de la suscripción local, pestaña «Ventas sin documento (27)» mostró 25 filas y controles 1/2 (`I5-pagination-page1.png`). Click real en página 2 disparó GET `page=2&limit=25` 200 y mostró solo los pedidos #913/#912, control 2 activo (`I5-pagination-page2.png`). No se forzó click ni se desactivó el paywall.
- Limpieza acotada por tag + rango de IDs eliminó exactamente las 27 filas de prueba; consulta residual = 0 y cola siguió 2→2. Capturas son evidencia transitoria, no datos que deban quedar en la BD.

La prueba de **evento creado por un fallo real de emisión POS** y la asignación de dueño/ADR del reintento automático siguen pendientes. Este documento solo cierra la brecha de paginación >25.

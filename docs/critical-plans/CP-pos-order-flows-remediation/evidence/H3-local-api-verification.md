# H.3 — matriz API local parcial (2026-09-23 UTC)

Entorno: backend local `localhost:3000`, base local `vendix_db`, tienda seed 10. No se tocó producción. Producto 425 (`Test de servicio`): 0 filas en `product_tax_assignments`; tienda 10 conserva `pos.tax_line_gate=block` legado.

| Carril | Evidencia request/headers/response | HTTP | Orden | Pago | Subtotal | IVA | Total | Items | Snapshots fiscales |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| POS nueva mesa (`table_id=8`, `items` en pago) | H3-pos-mesa-nueva.* | 201 | 1100 | 797 | 10000 | 0 | 10000 | 1 | 0 |
| POS sesión previa (`table_session_id=101`, `items` en pago) | H3-pos-mesa-previa-open.*, H3-pos-mesa-previa-pay.* | 201 | 1101 | 798 | 10000 | 0 | 10000 | 1 | 0 |
| Mesas (`add-items`, pago **sin** `items`) | H3-mesas-open.*, H3-mesas-add-items.*, H3-mesas-pay.* | 201/201/201 | 1102 | 799 | 10000 | 0 | 10000 | 1 | 0 |
| POS sin mesa | H3-pos-sin-mesa.* | 201 | 1103 | 800 | 10000 | 0 | 10000 | 1 | 0 |

`H3-snapshots.sql` y `H3-snapshots.txt` contienen la consulta y salida SQL. Cada orden tiene un pago `succeeded`; las tres mesas son QA locales 8/9/10. Los cuerpos de respuesta están conservados sin `invoice_data_token` por seguridad.

**No validado aún:** E2E visual/Network con Playwright (MCP ausente), tienda con módulo fiscal en otro estado, producto con categoría 0 % explícita, producto gravado, carrito mixto y snapshot antiguo. Un intento de sad/brute-force produjo solo 401 por token vacío: el login del seed alcanzó 429 por IP; esas respuestas se excluyen de esta evidencia y no prueban la conducta del checkout.

**Sad/brute-force API (misma tienda, token válido tras disiparse 429):** `quantity=0` devolvió 400 `SYS_VALIDATION_001`; `table_id=6` de otra tienda devolvió 404 `TABLE_NOT_FOUND`; reenvío del cobro de mesa 8 devolvió 409 `POS_TABLE_SESSION_ALREADY_CHARGED`. Las cuatro órdenes QA conservan un pago cada una después de los rechazos (`H3-snapshots.txt`). Cuerpos/headers: `H3-reject-{quantity,foreign-table,double-pay}.*`; se omitió `devDetails` interno del error de validación.

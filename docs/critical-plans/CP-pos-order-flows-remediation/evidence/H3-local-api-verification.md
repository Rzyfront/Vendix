# H.3 — matriz API local parcial (2026-09-23 UTC)

Entorno: backend local `localhost:3000`, base local `vendix_db`, tienda seed 10. No se tocó producción. Producto 425 (`Test de servicio`): 0 filas en `product_tax_assignments`; tienda 10 conserva `pos.tax_line_gate=block` legado.

| Carril | Evidencia request/headers/response | HTTP | Orden | Pago | Subtotal | IVA | Total | Items | Snapshots fiscales |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| POS nueva mesa (`table_id=8`, `items` en pago) | H3-pos-mesa-nueva.* | 201 | 1100 | 797 | 10000 | 0 | 10000 | 1 | 0 |
| POS sesión previa (`table_session_id=101`, `items` en pago) | H3-pos-mesa-previa-open.*, H3-pos-mesa-previa-pay.* | 201 | 1101 | 798 | 10000 | 0 | 10000 | 1 | 0 |
| Mesas (`add-items`, pago **sin** `items`) | H3-mesas-open.*, H3-mesas-add-items.*, H3-mesas-pay.* | 201/201/201 | 1102 | 799 | 10000 | 0 | 10000 | 1 | 0 |
| POS sin mesa | H3-pos-sin-mesa.* | 201 | 1103 | 800 | 10000 | 0 | 10000 | 1 | 0 |

`H3-snapshots.sql` y `H3-snapshots.txt` contienen la consulta y salida SQL. Cada orden tiene un pago `succeeded`; las tres mesas son QA locales 8/9/10. Los cuerpos de respuesta están conservados sin `invoice_data_token` por seguridad.

**Pendiente:** E2E visual/Network en navegador y prueba integrada de snapshot histórico gravado (el caso unitario está en `payments.service.spec.ts`, 76/76). Playwright MCP no está disponible; el Browser integrado es alternativa al estabilizar frontend. Un primer intento sad/brute-force produjo solo 401 por token vacío tras login 429; esas respuestas fueron reemplazadas por pruebas posteriores con token válido.

**Sad/brute-force API (misma tienda, token válido tras disiparse 429):** `quantity=0` devolvió 400 `SYS_VALIDATION_001`; `table_id=6` de otra tienda devolvió 404 `TABLE_NOT_FOUND`; reenvío del cobro de mesa 8 devolvió 409 `POS_TABLE_SESSION_ALREADY_CHARGED`. Las cuatro órdenes QA conservan un pago cada una después de los rechazos (`H3-snapshots.txt`). Cuerpos/headers: `H3-reject-{quantity,foreign-table,double-pay}.*`; se omitió `devDetails` interno del error de validación.

**Matriz fiscal real (tienda 10, fixtures QA locales):** `H3-qa-products.sql` creó productos de servicio 2470 con asignación explícita IVA 0 % (tasa 74) y 2471 con IVA 19 % (tasa 72), sin tocar el producto sin asignación 425. POS sin mesa cobró 2470 por 10000/IVA 0 (orden 1106), 2471 por 11900/IVA 1900 (1107) y el carrito mixto 425+2470+2471 por 31900/IVA 1900 (1108). POS **con mesa 12** cobró el mismo carrito por 31900/IVA 1900 (1109). Todas dieron HTTP 201, un pago `succeeded` por orden. SQL `H3-tax-matrix.sql/txt`: la línea 425 no tiene snapshot fiscal, 2470 conserva la fila de tasa 74/0 %, 2471 la de tasa 72/19 % por 1900; sin duplicar líneas ni pagos. Respuestas redactadas sin `invoice_data_token`. El primer intento coincidió con recompilación del backend y produjo `Empty reply from server`; se repitió con `/api/health=200`, sin registrar pago/orden intermedio.

**Área fiscal activa/LOCKED (tienda 3):** producto de servicio 426 sin asignación fiscal, POS sin mesa y con `table_id=13` dieron HTTP 201, órdenes 1110/1111 por 50000, impuesto 0, una línea y un pago `succeeded`, cero `order_item_taxes` (`H3-active-fiscal-*`, SQL adjunto). La suscripción seed estaba `expired` y bloqueó el primer intento con 403 `SUBSCRIPTION_003`, independiente del impuesto. Para la QA **solo local** se cambió temporalmente a `active`, se invalidó `sub:features:3`, y un `trap EXIT` restauró `expired`; SQL y Redis confirmaron restauración. La tienda 10 permanece con área fiscal `INACTIVE`. Esto prueba que el resultado sin impuesto no depende del área fiscal; falta el E2E visual.

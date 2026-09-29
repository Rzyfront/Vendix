# C.4 — KDS ENVÍO / PARA LLEVAR / mesa, API + SSE + UI (QA local)

Tienda #10, día de negocio 2026-09-23. Se crearon cuatro órdenes QA con el producto preparado **#333** sin receta activa y `track_inventory=false`; fire oficial creó tickets **#103** (`home_delivery`), **#104** (`direct_delivery`), **#105** (`dine_in`) y **#106** (`direct_delivery` para el evento vivo), todos en Cocina #1. El fire respondió **201** en cada caso **sin abrir turno KDS** y generó **cero transacciones de inventario** por línea. `order_item.is_takeaway=false` en los tres primeros: el rótulo depende de `order.delivery_type`, no de ese booleano.

| Lectura | Resultado observado |
| --- | --- |
| `GET /store/kitchen-fire/tickets` | HTTP **200**; #103 home, #104 direct, #105 dine-in con `order.delivery_type` e `items[].order_item.is_takeaway` intactos. |
| `GET /store/kitchen-fire/snapshot?windowMinutes=120` | HTTP **200**, `total=3` inicialmente; mismas tres clases y flags. Tras crear #106 también aparece. |
| `GET /store/kitchen-fire/stream` autenticado | HTTP **200**; `snapshot` inicial incluyó #103/#104/#105 con tipo. Al disparar #106 con conexión SSE viva llegó **`ticket.created`** con `order.delivery_type=direct_delivery`. |
| Playwright Node sobre `https://vendix.com/admin/restaurant-ops/kds` | Tablero recargado mostró **ENVÍO** solo en #103, **PARA LLEVAR** solo en #104, ningún badge de empaque en #105 (`C4-current-board.png`); errores JS: **0**. |
| Modales de detalle abiertos por la cabecera de cada tarjeta | #103 **ENVÍO**, #104 **PARA LLEVAR**, #105 **ninguno** (`C4-modal-home.png`, `C4-modal-direct.png`, `C4-modal-mesa.png`); errores JS: **0**. |

Conteo agrupado `is_takeaway` de tienda #10 antes y después de lecturas REST/UI: **false=937, true=29**, idéntico. El commit de C.4 `37005e554` modificó include/tipos/etiquetas, no el computado `allTakeaway` ni el guard takeaway-only de `markDelivered`; `kitchen-fire.service.spec.ts` **33/33**. E.3/DB-04 ya prueban que `delivery_type` declarado se persiste; este fixture confirmó el dato en la orden y los tres lectores.

Terminada la captura, `POST /store/orders/{1179,1180,1181,1182}/flow/cancel` devolvió **200** en los cuatro: órdenes y tickets #103-#106 quedaron `cancelled`, con **cero movimientos de inventario**, sin borrado duro ni alteración de producción. Datos y logs crudos locales: `/tmp/c4-current-*`. La estación Cocina #1 nunca se abrió (evitó el backfill de seis transacciones ajenas). C.4 cumple su matriz funcional; no prueba el 403 `KDS_STATION_LOCKED` pendiente de C.3.

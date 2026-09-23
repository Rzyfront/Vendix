# FB-22 DELETE no borra una orden con contenido o historia financiera

Entorno local, tienda QA #10. Antes del arreglo, `DELETE /api/store/orders/1136` de un borrador con una línea, cero pagos y cero reservas retornó **500 `SYS_INTERNAL_001`** por FK `order_items_order_id_fkey` (`P2003`); la orden siguió en draft. `orders` tiene 17 tablas con FK directa, así que borrar hijos en cascada para hacer pasar el hard delete destruiría la historia de la venta. La UI real no llama DELETE: ofrece «Cancelar Orden» (véase `A4-ui-draft-cancel.md`).

`1ed057bd5` mantiene el DELETE de shells vacíos sin evidencia financiera, pero preflight rechaza una orden con ítems y captura cualquier FK dependiente que aparezca por carrera como `ORD_VALIDATE_001` tipado, invitando a cancelar. La guarda financiera previa se conserva. Jest `orders.service.spec.ts`: **105/105**, incluidos ítems presentes, FK P2003 y evidencia financiera.

Tras recompilar, DELETE #1136 respondió **400 `ORD_VALIDATE_001`** con `details={state:'draft',reason:'order_items_present'}`; DELETE orden pagada QA #1130 respondió **400 `ORD_VALIDATE_001`** con `reason:'financial_evidence'`. Ninguna se borró; #1130 conservó su pago. Para limpiar el fixture, `POST /store/orders/1136/flow/cancel` respondió **200** y la orden pasó a cancelled, conservando historia. `A4-fb22-delete-guard.sql/txt` documenta el estado final.

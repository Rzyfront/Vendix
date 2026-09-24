# C.2 — entrega de remisión proyecta KDS pendiente (QA local, red→green)

Tienda #10, 2026-09-23. Producto preparado #333 sin receta ni control de stock, estación Barra #7 solo durante el fire, cliente #197, dirección #489 y envío #9. `kds_id` del producto restaurado a NULL inmediatamente después de cada fire. Ambos recorridos usaron las APIs oficiales POS→cocina→cobro→remisión; no se abrió turno KDS ni se generó movimiento de inventario.

| Fase | APIs y filas | Resultado de orden/KDS |
| --- | --- | --- |
| **Antes del arreglo** | POS borrador #1186/ítem #1910 (201), fire ticket #110 `pending` (201), `flow/pay` (200), remisión #229 create/confirm/deliver (201/201/201) | orden pasó a `finished`, `order_items.delivered_at=2026-09-23 13:31:57.727`, pero **ticket #110 y su ítem siguieron `pending`**. DB-23 falló después del corte. |
| **Después del arreglo** | mismo carril, orden #1187/ítem #1911, ticket #111 `pending`, remisión #230 | `delivered_at=2026-09-23 13:36:49.671`; **ticket #111 y su ítem `delivered`**. Orden llegó finalmente a `finished` (la primera lectura inmediata vio `delivered` durante la conciliación asíncrona). Cero stock. |

El listener ahora invoca `OrderFlowService.reconcileKitchenAfterDispatch` dentro de `StoreContextRunner` **después** de estampar la entrega y **antes** de derivar el estado de la orden. La proyección toma solo líneas entregadas, no canceladas y con ticket, y actualiza la fila KDS vigente aun si estaba `pending`; no emite el puente de estado **cocina→orden** porque el despacho gobierna ese estado. Se ejecuta también con cero sellos nuevos para reparar un fallo anterior en un replay sin mover `delivered_at`. Los ítems sin ticket siguen registrándose para auditoría.

Prueba focalizada de OrderFlow primero **roja** (`reconcileKitchenAfterDispatch is not a function`), luego **verde**; suites completas OrderFlow **131/131** + DispatchNoteEventsListener **27/27** = **158/158**. El spec del listener fija orden `stamp → kitchen → order` y replay; el de OrderFlow fija alcance por tienda, exclusión de líneas canceladas, salto `pending→delivered`, cierre del ticket y ausencia de puente KDS. Backend watch/API READY y `/health` HTTP200. Logs y cuerpos crudos `/tmp/c2-dispatch-*`, `/tmp/c2-postfix-*`, `/tmp/c2-dispatch-full-tests.log`.

Se corrigió la anomalía creada por el fixture **anterior** mediante APIs oficiales: ticket #110 `ready` 201 y replay idempotente `PATCH /orders/1186/flow/items/1910/deliver` 200; su marca temporal no se movió y KDS quedó `delivered`. Auditoría DB-23 del ticket **vigente**: **0 descuadres con `delivered_at>=2026-09-23`**. Persiste solo el legado real #1692, previo al corte; no hubo backfill de negocio.

La auditoría SSE de la proyección vive en `C2-ticket-updated-sse-20260923.md` (ticket #112 parcial/final + replay sin duplicado). Pendiente de C.2: caso revert de ticket por curl con SQL incremental y aceptación formal de ADR-06. No se declara aún que toda la fase C esté completa.

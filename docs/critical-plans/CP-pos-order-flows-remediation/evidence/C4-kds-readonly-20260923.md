# C.4 — contrato histórico de tickets; snapshot de hoy vacío

QA local de solo lectura 2026-09-23, tienda #10. `GET /store/kitchen-fire/tickets` autenticado devolvió 200 y las órdenes/tickets históricos confirman que la forma de lista trae `order.delivery_type` además del `order_item.is_takeaway` preexistente:

| Ticket | delivery_type | is_takeaway | Lectura SQL/API |
| --- | --- | --- | --- |
| #53 | `home_delivery` | false | coinciden |
| #93 | `direct_delivery` | true | coinciden |
| #98 | `direct_delivery` | false en ambas líneas | coinciden |
| #44 | `dine_in` | false | coinciden |

No se deduce de estas filas una comparación antes/después de `is_takeaway`; solo que el contrato conserva ambos campos. En el día de negocio actual había **cero tickets**: snapshot REST con `windowMinutes=120` y `720` respondió `total:0`, SSE autenticado HTTP200 emitió `snapshot` vacío, y la UI de Cocina mostró tablero vacío (`C4-kds-current-day-empty.png`). `windowMinutes` no amplía el snapshot a días históricos. Así que **no** se afirma que snapshot/SSE poblados ni badges visibles ENVÍO/PARA LLEVAR/sin empaque estén verificados. No se abrió estación KDS ni se fabricó ticket: Cocina #1 tiene backfill huérfano de inventario al abrir (ver `C3-station-lock-safety-20260923.md`).

Evidencia cruda local `/tmp/c4-kds-verification/`. C.4 permanece **in-progress** hasta disponer de tickets QA actuales seguros para las tres intenciones y capturar el tablero/modal.

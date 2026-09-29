# C.2 / DB-23 — auditoría del ticket vigente, no de filas históricas

Consulta read-only sobre toda la BD local, 2026-09-23. El SQL previo de DB-23 cruzaba **todas** las filas `kitchen_ticket_items` de una línea contra `delivered_at`: reportó tres supuestos descuadres (#915, #1660 y #1692). Esa consulta es demasiado amplia porque el mismo `order_item` puede tener varios tickets después de un re-fire y el estado vigente es la fila de mayor `kitchen_ticket_items.id`, igual que `deriveStaticKitchenStatus` del frontend y `syncKitchenOnOrderItemDelivered` del backend.

| Ítem | Filas KDS ordenadas por historia | Resultado correcto |
| --- | --- | --- |
| #915 | ticket #31 `pending` viejo; ticket #76 `delivered` nuevo | **sin descuadre vigente** |
| #1660 | ticket #77 `cancelled` viejo; #78 y #79 `delivered` nuevos | **sin descuadre vigente** |
| #1692 | solo ticket #83 `ready`, `delivered_at=2026-09-01` | **un descuadre histórico real** |

`C2-latest-ticket-audit-20260923.sql` devuelve **1** fila vigente incongruente (#1692, tienda #10, orden #1008, ticket item #87) en toda la BD y **0** filas con `delivered_at >= 2026-09-23`. La consulta secundaria de DB-08 `delivered_at > updated_at` aún da 18 filas, todas anteriores a 2026-09-23; ese predicado no demuestra monotonicidad por sí mismo y no se usa para declarar arreglo global. No se editó ninguna fila histórica: el plan excluye backfill sin decisión de negocio.

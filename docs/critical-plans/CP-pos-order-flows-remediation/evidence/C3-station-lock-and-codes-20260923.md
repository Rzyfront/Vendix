# C.3 — lock KDS real sin backfill y matriz de códigos (QA local)

Tienda #10, 2026-09-23. Se evitó abrir Cocina #1 (tenía seis consumos históricos huérfanos por atribuir). En su lugar, por API oficial se asignó temporalmente el producto preparado **#333**, sin receta y sin stock, a **Barra #7**; se creó orden QA **#1183** / ítem **#1906** y se disparó ticket **#107** (`pending`, estación #7, **0** `inventory_transactions`). La asignación `products.kds_id` se restauró a NULL inmediatamente después del fire; `kitchen_tickets.kds_id=7` quedó como snapshot. Antes de abrir el turno, Barra tenía **0** consumos huérfanos y **0** sesiones abiertas.

Usuario de cocina **#242** abrió oficialmente turno Barra **#42** (HTTP **201**, `last_seen_at` fresco). Usuario mesero **#241**, distinto y sin privilegio de override pero con `kitchen_fire:update`, hizo estas sondas sobre ticket #107:

| Acción | HTTP / código | Integridad |
| --- | --- | --- |
| `POST /tickets/107/start` | **403 `KDS_STATION_LOCKED`**, `details.kds_id=7`, `opened_by=242` | ticket siguió `pending` |
| `POST /tickets/107/ready` | **403 `KDS_STATION_LOCKED`** | ticket siguió `pending` |
| `POST /tickets/107/delivered` | **403 `KDS_STATION_LOCKED`** | `order_items.delivered_at=NULL` |
| `POST /tickets/107/cancel` | **403 `AUTH_PERM_001`** | el mesero no tiene permiso `kitchen_fire:cancel`, así que RBAC bloquea antes del lock; **no** se cuenta como prueba de KDS lock |

Turno #42 se cerró por API oficial (HTTP **201**) con **0** movimientos atribuidos/backfill, y la orden/ticket QA se cancelaron por `flow/cancel` **200** (ticket `cancelled`, 0 inventario). Producto #333 quedó con `kds_id=NULL`. Ningún dato de producción se tocó.

Matriz adicional de rechazos reales, todos sin mutación: ticket mixto/listo #94 `delivered` → **422 `KITCHEN_TICKET_NOT_TAKEAWAY`**; ítem preparado pendiente #1767/orden #1063 `deliver` → **409 `ORDER_ITEM_NOT_DELIVERABLE`**; ticket pendiente #99 `delivered` → **409 `KITCHEN_TICKET_NOT_READY`**; ticket entregado #101 re-entrega → **409 `KITCHEN_TICKET_ALREADY_DELIVERED`**; ticket cancelado #107 `delivered` → **409 `KITCHEN_TICKET_ALREADY_CANCELLED`**. El estado de los tickets #99/#101/#107 quedó invariante. Catálogo y `error-messages.ts` contienen los códigos; KitchenFireService **33/33**, controller **1/1**, Angular error-messages **20/20** en el lote previo.

Pendiente de C.3: toasts Playwright visibles para los tres rechazos principales en sus superficies. El mesero no ve el KDS (carece de `store:kds:read`) y el único cocinero de la tienda es #242, dueño del turno #42; no se fabricó un segundo usuario ni se abrió Cocina #1 para simular la UX. Evidencia cruda local `/tmp/c3-barra-*` y `/tmp/c3-deliver-*.response.json`.

# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `orders` | `id,store_id,state` | R | `StorePrismaService` y contexto | Ninguna | Lista, GET id, fire | Orden de otra tienda no se expone | Curl cross-tenant en dev: 404/403 | [ ] |
| DB-02 | `order_items` | `id,quantity,skip_kds,cancelled_at,inventory_consumed_at_fire` | R; W solo fire existente | Relación scoped de orden | Ninguna | Elegibilidad/POST | Fire solo de pendientes elegibles | Fixture mixto y revisar ids/tickets | [ ] |
| DB-03 | `products` | `product_type` | R | Relación de item scoped | Ninguna | Gate prepared | Solo `prepared` participa | Fixture físico + prepared | [ ] |
| DB-04 | `kitchen_ticket_items` | `id,order_item_id,status,kitchen_ticket_id` | R; W KDS existente | A través de orden/ticket scoped | Ninguna | Agregación/SSE | En vuelo gana a terminal viejo | Spec con reenvío y cancelado | [ ] |
| DB-05 | `kitchen_tickets` | `id,order_id,store_id,status` | R; W fire/KDS existente | `store_id` en servicio | Ninguna | SSE y GET detalle | Evento identifica la orden correcta | Fixture dos tiendas + ticket.* | [ ] |
| DB-06 | `inventory_movements` | cantidad/costo | W por fire existente | Tienda/transacción de fire | Ninguna | Stock/COGS | Un clic genera un consumo, doble clic no | Antes/después de POST en dev | [ ] |
| DB-07 | `order_events` | `type,order_id` | W por fire existente | Transacción de fire | Ninguna | Auditoría | `kitchen_fired` solo tras fire efectivo | Consultar eventos fixture dev | [ ] |

# Frontend↔Backend Contract Registry

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `GET /store/orders/stream?token=JWT` | `?token=` raw en req.query | `{id,type,data:{order_id,kind,...}}` SSE | `orders-list-sse.service.ts:91` | `+ aceptar order.created` | Pintar orden ajena | `curl -N '/store/orders/stream?token=$JWT' y crear orden POS` | [ ] |
| FB-02 | `GET /store/orders/:id` | `ParseIntPipe id` | `{data: Order}` ResponseService | `orders-list.component.ts effect nuevo` | `+ GET por cada created` | Storm si pico alto | `curl /store/orders/123 | jq .data.id` vs Order iface | [ ] |
| FB-03 | `GET /store/orders?page&limit&status` | `OrderQueryDto` paginado+filtrado | `{data:{data[],pagination{total}}}` | `store-orders.service getOrders` | `sin cambio, solo reuso` | Total desincronizado | `curl '/store/orders?page=1&limit=10' | jq .data.pagination` | [ ] |
| FB-04 | `POST /store/orders` (POS/manual) | `CreateOrderDto` | `{data: Order}` | `payments.service` + POS | `sin cambio, emisor ya existe` | Created no emitido | `crear orden POS y ver evento en stream abierto` | [ ] |
| FB-05 | `POST /store/checkout` (ecommerce) | `CheckoutDto` | `{data: Order}` | `checkout.service` | `sin cambio, emisor ya existe` | Created no emitido | `checkout seed y ver order.created en stream` | [ ] |

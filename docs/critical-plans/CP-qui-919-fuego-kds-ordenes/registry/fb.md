# Frontend↔Backend Contract Registry

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `GET /store/orders` | `OrderQueryDto` paginado | Filas con `order_items` mínimos y tickets KDS | `OrdersListComponent` | Añadir proyección de cocina | N+1 o resumen falso | `curl` en dev con restaurante y orden mixta | [ ] |
| FB-02 | `GET /store/orders/:id` | id numérico | Orden con `order_items` y tickets ordenados | Rehidratación tras SSE/fire | Sin cambio de ruta | Respuesta fuera de orden | `curl` y comparar estado con FB-01 | [ ] |
| FB-03 | `POST /store/kitchen-fire` | `FireOrderItemsDto` con ids pendientes | `FireOrderItemsResult` y tickets | `KitchenTicketsService.fireOrderItems` | Reusar sin alterar contrato | Doble consumo o ids ajenos | `curl` dev: un POST, repetir, revisar tickets | [ ] |
| FB-04 | `GET /store/orders/stream?token=JWT` | JWT por query | `ticket.*` con `ticket.order_id`; `order.items.updated` con `data.order_id` | `OrdersListSseService` | Consumir cocina y cambios de ítems | F5 necesario o refresh ajeno | EventSource dev + transición KDS, observar GET puntual | [ ] |
| FB-05 | `POST /store/print-formats/render` | `kitchen_ticket` + ticket id | HTML/comanda o error | `KitchenTicketPrintService` | Reusar tras fire físico | Reintento de fire por confusión | Simular gateway fallido y reimpresión en detalle | [ ] |

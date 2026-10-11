# Frontend↔Backend Contract Registry

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `GET /store/orders?page=1&limit=10` | `OrderQueryDto` | Lista paginada con `cancellation_policy.can_cancel` y `reason_code` por fila | `orders-list.component.ts` | Sin cambio; gate de acción móvil | Mostrar cancelación indebida | `curl -H "Authorization: Bearer $JWT" "$API/store/orders?page=1&limit=10"` y revisar `cancellation_policy` | [ ] |
| FB-02 | `PATCH /store/orders/:id` | `UpdateOrderDto {state:'cancelled'}` | Orden o error HTTP (inesperado: 500 `SYS_INTERNAL_001`) | `StoreOrdersService.updateOrderStatus()` | Botón directo; relanzar fallo solo al cancelar | Éxito falso o PATCH duplicado | Playwright: 0/1 PATCH; spec controller error/no cancelación | [ ] |
| FB-03 | `GET /store/orders?dispatchable=true` | `OrderQueryDto.dispatchable` | Lista filtrada paginada | `toggleDispatchable()` + `StoreOrdersService` | Sin cambio; solo tamaño del botón | Filtro visual desincronizado | Playwright: URL y respuesta de red tras dos toques | [ ] |

# Reusable Assets

`apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts` — fire transaccional, idempotencia, COGS y evento `ticket.*` después de commit.
`apps/frontend/src/app/private/modules/store/restaurant-ops/kds/services/kitchen-tickets.service.ts` — `fireOrderItems` HTTP existente.
`apps/frontend/src/app/private/modules/store/restaurant-ops/kds/services/kitchen-ticket-print.service.ts` — impresión automática física.
`apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts` — `kitchenStateForItem`, elegibilidad, etiquetas y patrón de toast.
`apps/frontend/src/app/shared/components/table/table.component.ts` — acciones dinámicas con variante/tooltip/disabled.
`apps/frontend/src/app/shared/components/item-list/item-list.component.ts` — tarjetas y orden de acciones directas.
`apps/frontend/src/app/private/modules/store/orders/services/orders-list-sse.service.ts` — conexión única y backoff SSE.

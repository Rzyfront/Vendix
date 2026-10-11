# Critical Files

`apps/backend/src/domains/store/orders/orders.service.ts` — `findAll` proyecta ítems; ampliar lectura mínima KDS.
`apps/backend/src/domains/store/orders/orders.service.spec.ts` — probar proyección paginada y scope.
`apps/backend/src/domains/store/kitchen-fire/kitchen-fire.controller.ts` — contrato POST y permisos; lectura.
`apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts` — B.2 serializa y revalida fire; SSE y estado físico.
`apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts` — acción, agregación, fire y reconciliación.
`apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.html` — bindings responsive.
`apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.spec.ts` — carrera, skip_kds, estado terminal.
`apps/backend/src/common/errors/error-codes.ts` — nuevo error de inelegibilidad.
`apps/frontend/src/app/private/modules/store/orders/components/orders-list/order-kitchen-summary.util.ts` — utilidad pura nueva de agregación.
`apps/frontend/src/app/private/modules/store/orders/components/orders-list/order-kitchen-summary.util.spec.ts` — pruebas de cuello de botella.
`apps/frontend/src/app/private/modules/store/orders/services/orders-list-sse.service.ts` — parser SSE KDS.
`apps/frontend/src/app/private/modules/store/orders/services/orders-list-sse.service.spec.ts` — pruebas SSE.
`apps/frontend/src/app/private/modules/store/orders/services/store-orders.service.ts` — GET de orden; lectura.
`apps/frontend/src/app/private/modules/store/restaurant-ops/kds/services/kitchen-tickets.service.ts` — POST existente; lectura.
`apps/frontend/src/app/private/modules/store/restaurant-ops/kds/services/kitchen-ticket-print.service.ts` — imprimir tras fire y guiar al detalle si falla.
`apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts` — selector y gate de referencia; lectura.
`apps/frontend/src/app/shared/components/table/table.component.ts` — contrato `TableAction`; lectura salvo fallo a11y demostrado.
`apps/frontend/src/app/shared/components/item-list/item-list.component.ts` — acciones móviles/tooltip; lectura salvo fallo a11y demostrado.
`apps/frontend/src/app/private/modules/store/orders/interfaces/order.interface.ts` — tipar proyección mínima.

# Critical Files

<!-- [MANDATORY] Concrete paths only, zero wildcards — one line per file: `path/to/file.ts` — role. -->
`apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts` — Acciones de orden, política visible, `cancelOrder()` y `toggleDispatchable()`.
`apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.html` — Toolbar y binding de `app-responsive-data-view`.
`apps/frontend/src/app/shared/components/responsive-data-view/responsive-data-view.component.ts` — Separar `mobileActions` opcional del arreglo de tabla.
`apps/frontend/src/app/shared/components/item-list/item-list.component.html` — Referencia de primeros dos botones y menú, lectura solamente.
`apps/frontend/src/app/shared/components/item-list/item-list.component.ts` — `executeAction` detiene propagación; referencia de contrato.
`apps/frontend/src/app/shared/components/button/button.component.ts` — `customClasses`, `ariaLabel`, nueva entrada opcional `ariaPressed`.
`apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.component.scss` — Referencia de tamaño 40/44 px; lectura solamente.
`apps/frontend/src/app/private/modules/store/orders/services/store-orders.service.ts` — `updateOrderStatus()` y consulta de órdenes; lectura solamente.
`apps/backend/src/domains/store/orders/orders.controller.ts` — Permisos y contrato GET/PATCH; rama de error de cancelación a modificar en B.3.
`apps/backend/src/domains/store/orders/orders.controller.spec.ts` — Regresión de error inesperado, error tipado y PATCH no cancelatorio en B.3.
`apps/backend/src/common/filters/http-exception.filter.ts` — Referencia de mapeo global a HTTP 500 `SYS_INTERNAL_001`; lectura solamente.
`apps/backend/src/common/responses/response.service.ts` — Referencia del envelope `success:false`; lectura solamente.
`apps/backend/src/domains/store/orders/orders.service.ts` — Proyección `cancellation_policy`; lectura solamente.
`apps/backend/src/domains/store/orders/order-flow/order-cancellation-policy.util.ts` — Regla de cancelabilidad; lectura solamente.

# Critical Files

<!-- [MANDATORY] Concrete paths only, zero wildcards — one line per file: `path/to/file.ts` — role. -->

`apps/backend/src/domains/store/orders/orders.service.ts` — Emite order.created:596 y listeners onOrderCreated/onOrderStatusChanged que empujan al SSE.
`apps/backend/src/domains/store/orders/orders.controller.ts` — GET stream:256 (@Sse) con permiso store:orders:read y subject por tienda.
`apps/backend/src/domains/store/orders/services/order-sse.service.ts` — Hub pushOrderEvent que envuelve NotificationsSseService por store_id.
`apps/backend/src/domains/store/notifications/notifications-sse.service.ts` — Subject compartido por tienda, push/unsubscribe, heartbeat.
`apps/backend/src/domains/ecommerce/checkout/checkout.service.ts` — Emite order.created:1629 y 2382 (ecommerce).
`apps/backend/src/domains/store/payments/payments.service.ts` — Emite order.created:1427 (POS con pago).
`apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` — Emite order.status_changed:380+429 (convive, no tocar).
`apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts` — Lista /admin/orders/sales, loadOrders:853, effect SSE:590, flash seen.
`apps/frontend/src/app/private/modules/store/orders/services/orders-list-sse.service.ts` — Cliente SSE lista; hoy descarta order.created:203.
`apps/frontend/src/app/private/modules/store/orders/services/order-detail-sse.service.ts` — Cliente SSE detalle; patron EventSource+backoff a replicar.
`apps/frontend/src/app/private/modules/store/orders/services/store-orders.service.ts` — getOrders y getOrderById para hidratar fila nueva.
`apps/frontend/src/app/private/modules/store/orders/services/orders-list-sse.service.spec.ts` — Spec que aserta descarte de created:97; debe actualizarse.
`apps/frontend/src/app/private/modules/store/orders/orders/orders.component.ts` — Host app-orders con reloadTick y stats.
`apps/frontend/src/app/private/modules/store/orders/components/order-stats/order-stats.component.ts` — Stats del header a refrescar.

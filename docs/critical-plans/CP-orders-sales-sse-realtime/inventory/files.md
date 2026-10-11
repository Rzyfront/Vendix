# Critical Files

<!-- [MANDATORY] Concrete paths only, zero wildcards — one line per file: `path/to/file.ts` — role. -->

`apps/backend/src/domains/store/orders/orders.service.ts` — Emite order.created y tiene onOrderCreated/onOrderStatusChanged que empujan al SSE.
`apps/backend/src/domains/store/orders/orders.controller.ts` — GET /store/orders/stream (@Sse) con permiso store:orders:read y subject por tienda.
`apps/backend/src/domains/store/orders/services/order-sse.service.ts` — Hub pushOrderEvent que envuelve NotificationsSseService por store_id.
`apps/backend/src/domains/store/notifications/notifications-sse.service.ts` — Subject compartido por tienda, push/unsubscribe, heartbeat.
`apps/backend/src/domains/ecommerce/checkout/checkout.service.ts` — Emite order.created en checkout ecommerce y WhatsApp.
`apps/backend/src/domains/store/payments/payments.service.ts` — Emite order.created en POS con pago.
`apps/backend/src/domains/store/orders/services/order-sse.service.spec.ts` — Cubre payload/tenant del hub y rechazo de IDs inválidos.
`apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` — Emite order.status_changed:380+429 (convive, no tocar).
`apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts` — Lista /admin/orders/sales, loadOrders:853, effect SSE:590, flash seen.
`apps/frontend/src/app/private/modules/store/orders/services/orders-list-sse.service.ts` — Cliente SSE lista; acepta status_changed y created.
`apps/frontend/src/app/private/modules/store/orders/services/order-detail-sse.service.ts` — Cliente SSE detalle; patron EventSource+backoff a replicar.
`apps/frontend/src/app/private/modules/store/orders/services/store-orders.service.ts` — getOrders y getOrderById para hidratar fila nueva.
`apps/frontend/src/app/private/modules/store/orders/services/orders-list-sse.service.spec.ts` — Specs de parseo created/status y descarte de otros tipos.
`apps/frontend/src/app/private/modules/store/orders/orders/orders.component.ts` — Host app-orders con reloadTick y stats.
`apps/frontend/src/app/private/modules/store/orders/components/order-stats/order-stats.component.ts` — Stats del header a refrescar.
`apps/mobile/app/(store-admin)/orders.tsx` — Lista móvil; abre SSE al enfocarse y refresca `['orders', search, activeFilter]` / `['order-stats']`.
`apps/mobile/src/features/store/services/order-sse.service.ts` — Cliente SSE móvil que valida tipos/IDs, renueva sesión por REST, aplica backoff y cleanup.
`apps/mobile/src/core/api/endpoints.ts` — Constante `/store/orders/stream` en ORDERS.
`apps/mobile/src/core/auth/store-switcher.ts` — Purga `['orders']` y `['order-stats']` al cambiar tienda.
`apps/mobile/src/core/auth/use-permissions.ts` — Expone el tipo `store:orders:read` para gatear la conexión SSE.
`apps/mobile/src/core/store/auth.store.ts` — Logout purga cache de órdenes y estadísticas.
`apps/mobile/src/core/api/query-client.ts` — Configuración `staleTime: 30_000`, `refetchOnWindowFocus: false`.
`apps/mobile/src/core/store/tenant.store.ts` — `storeId` activo para aislar el ciclo de vida del stream.
`apps/mobile/src/core/auth/token.storage.ts` — `getToken()` obtiene el token vigente para cada conexión.

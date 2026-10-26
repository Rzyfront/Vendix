# Flujos: liquidación, cierre, tracking, UI y permisos

## Endpoints (`route-flow.controller.ts`)

`POST /store/dispatch-routes/:id/{dispatch,close,void,pdf}`, `GET /:id/close-options`, `POST /:id/stops/:stopId/{start,settle,release}`, tracking `POST /:id/tracking/positions`, `GET /:id/tracking`, SSE `GET /:id/tracking/stream?token=`; espejo app Repartos `POST /store/carrier/route/tracking/positions`. Escáner de hojas: `route-sheet-scanner.service.ts`.

## Liquidar parada (`cash-settlement.service.ts`)

Desde 2026-10-14 el recaudo en ruta NO exige caja: `settleStop` no escribe `cash_register_movements` ni llama `assertSessionForSales` (`recordCashMovement` está `@deprecated`). Orden:
1. `emitPaymentReceived` si `collected_amount + anticipo_amount > 0` y no prepagada: `payment.received` con `source_type='dispatch_route'`, `source_id=route_id`, `stop_id`, `order_id=sales_order_id` (puede ser null), `payment_id: null`, `withholding_breakdown` `[{code, amount}]`, montos completos.
2. `emitRefundCompleted` si `change_amount > 0`: con `sales_order_id`, inserta `refunds` (`state='completed'`, `refund_method='cash_on_route'`); siempre emite `refund.completed` (`source_type='dispatch_route_change'`, `source_id=stop_id`).

## Cerrar contra caja

- `GET /:id/close-options` → `{ cash_required, sessions[] }` (`cash_required` = `pos.cash_register.enabled`, misma lectura que `assertSessionForSales`).
- `POST /:id/close` con `declared_cash` y `cash_register_session_id?`. Errores: sin sesión requerida → 400 `DISPATCH_ROUTE_CASH_SESSION_REQUIRED`; sesión no `open` o de otra tienda → 409 `DISPATCH_ROUTE_CASH_SESSION_INVALID`; ya cerrada (bajo `FOR UPDATE`) → 409 `DISPATCH_ROUTE_ALREADY_CLOSED`; parada no terminal → 400 "Hay N parada(s) sin liquidar".
- `CashSettlementService.recordRouteCloseMovements`: UN movimiento `sale` por método (`reference = dispatch_route:{id}:close:{method}`, `user_id = session.opened_by`), excluye paradas con movimiento legado `dispatch_route:{id}:stop:{stopId}`; persiste `settlement_cash_*`.
- NO emite `cash_register.movement` (el listener solo entiende `cash_in`/`cash_out` y trataría `sale` como retiro). El recaudo se asienta por `payment.received`.
- Calcula totales y `cash_variance`, emite `dispatch_route.closed` → `AutoEntryService.onDispatchRouteClosed` asienta SOLO la diferencia de caja (gate fiscal `cash_register`); no re-contabiliza recaudo ni retenciones.

## Encargado y tracking

- Encargado = `driver_user_id` si `!is_primary_driver_external`; si existe, solo él despacha (403 `DISPATCH_ROUTE_NOT_RESPONSIBLE`); conductor externo ⇒ cualquiera con `dispatch`.
- Solo el encargado interno publica posiciones de una ruta `dispatched|in_transit`. Lectura: snapshot con trail ≤ 500 y SSE.
- Frontend: `RoutePositionPublisherService` (solo encargado; sobrevive al cambio de página; para con 403/404/409) y `RouteTrackingService` (SSE + polling 15 s). El espectador nunca usa geolocalización. Vista `/admin/orders/planillas/:id/recorrido` (`pages/planilla-route-view-page`).

## Escáner de planillas

Nunca deriva `partial`: hoja entregada con cobro menor al neto → `skipped[]` con `reason: 'short_payment_requires_decision'` (+ `collected_amount`, `net`) y no se liquida.

## Permisos `store:dispatch_routes:*`

`create`, `read` (lista + stats), `read:one`, `update`, `delete`, `dispatch`, `settle` (start/settle), `release_stop`, `close`, `void`, `print` (PDF). `admin`/`owner` los reciben vía el seed.

## Frontend (`apps/frontend/src/app/private/modules/store/planillas-rutas/`)

- Lista (`components/planillas-list`): cards en `<md`, tabla en `>=md`.
- Detalle (`pages/planilla-detail-page`): cards por parada (verde entregada, rojo liberada/rechazada; `partial` histórico verde), botones grandes Liquidar/Liberar.
- Wizard, modales settle/release/close (bottom-sheet móvil; el de cierre calcula la diferencia en vivo), visor PDF (blob + `URL.createObjectURL`), mapa, monitor, stats.
- Sidebar ("Rutas") → `orders_dispatch_routes` en `menu-filter.service.ts`.

## Backend

`apps/backend/src/domains/store/dispatch-routes/` (`dispatch-routes.service.ts`, `vehicles.*`, `route-flow/{route-flow,cash-settlement,pdf-export,route-sheet-scanner}.service.ts`, `tracking/`, `utils/route-stop-calc.ts`).

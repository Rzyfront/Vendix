---
name: vendix-dispatch-routes
description: >
  Planillas de despacho (rutas DSD con recaudo): agrupar remisiones en ruta con vehículo/conductor y
  paradas, captura móvil y cuadre de recaudo. Trigger: dispatch_routes, dispatch_route_stops,
  vehicles, liquidación de ruta, declared_cash, PDF de ruta.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Editing dispatch_routes or dispatch_route_stops schema or service"
    - "Editing the route flow (dispatch, settle, release-stop, close, void)"
    - "Modifying cash_variance or declared_cash logic"
    - "Editing the route PDF builder (pdf-export.service.ts)"
    - "Adding new transitions to dispatch_route_status_enum"
    - "Working with withholding_breakdown per stop (retefuente/reteiva/reteica)"
    - "Modifying the planillas-rutas frontend module"
    - "Adding new fields to dispatch_route_stop_history audit log"
---

## Alcance

Planillas de despacho DSD con recaudo: agrupar remisiones en una ruta con vehículo/conductor/auxiliares, liquidar paradas en ruta y cuadrar el recaudo al cerrar. Código: `apps/backend/src/domains/store/dispatch-routes/` y `apps/frontend/src/app/private/modules/store/planillas-rutas/`.

Detalle bajo demanda: columnas en `references/data-model.md`; endpoints, liquidación, cierre contra caja, tracking, permisos y UI en `references/flows.md`.

## Regla central: orquestar, no duplicar

La planilla es un agregador. Al liquidar emite eventos que ya manejan los listeners existentes; no crear pipelines paralelos de contabilidad, caja, cartera o notificaciones.

| Evento | Efecto |
|---|---|
| `payment.received` (`source_type='dispatch_route'`, `payment_id: null`) | Asiento (si el gate fiscal `payments` está activo), comisiones, notificaciones |
| `refund.completed` (`source_type='dispatch_route_change'`) | Asiento de vueltas |
| `dispatch_route.closed` | `onDispatchRouteClosed` asienta solo `cash_variance` (gate `cash_register`) |
| `credit_sale.created` | La ruta ya NO lo emite |

Sin asientos con el gate fiscal inactivo es comportamiento correcto (activación fiscal opt-in), no bug.

## Estados

- Ruta: `draft → dispatched → in_transit` (auto al iniciar la primera parada) `→ closed`; `voided` desde draft/dispatched/in_transit. No existe `settling`: `close()` solo desde `dispatched` o `in_transit`; `closed` es inmutable.
- Parada: `pending → in_progress → delivered | rejected`; `released` desde cualquier no terminal (única forma de liberar la remisión). Solo hacia adelante. Cada transición se audita en `dispatch_route_stop_history`.

## Invariantes

1. **Sin pago parcial por parada.** `delivered` solo con pago total o prepagada (retención permitida); `settleStop` rechaza `result='partial'` (400 `DISPATCH_ROUTE_PARTIAL_DISABLED`) y `delivered` si `collected + anticipo + withholding < grand_total`. Sin cobro completo → `rejected`.
2. **Ruta parcial sí.** Cerrar con mezcla de `delivered`/`rejected`/`released` es normal; solo bloquea una parada `pending`/`in_progress`.
3. **Sin crédito en ruta:** nunca crear `accounts_receivable` ni escribir `credit_amount`/`total_credit` (siempre 0; enviarlo → 400).
4. **`partial` se conserva en enums y en lectura** (`SETTLED_RESULTS` en `utils/route-stop-calc.ts`, badges, `per_delivery`): quitarlo exige migración destructiva y rompería el cierre de rutas históricas.
5. **Recaudo sin caja en ruta; se asienta al cerrar** contra la sesión elegida (`recordRouteCloseMovements`, un `sale` por método). No emitir `cash_register.movement` por ese `sale`.
6. **`cash_variance = declared_cash - cash_collected`**; prepagadas fuera de `total_to_collect` y del cuadre (`is_prepaid` derivado de `dispatch_note.invoice.payment_date`).
7. **UNIQUE parcial** de `dispatch_note_id` (`WHERE status != 'released'`); un UNIQUE simple bloquea la reasignación.
8. **Retenciones por parada** solo si el cliente es agente retenedor (`users.is_withholding_agent` del customer); `withholding_breakdown` debe sumar `withholding_amount`.
9. **Encargado:** con conductor interno principal, solo él despacha y publica tracking.
10. Vehículos referenciados por rutas no anuladas se desactivan, no se borran.

## Trampas

- `cash_register_sessions` usa `opened_by`, no `user_id`.
- `sales_orders` no tiene `payment_status`; prepago por `dispatch_notes.invoice.payment_date`.
- `refunds` exige `order_id`: sin `sales_order_id`, solo emitir el evento.
- Coordenadas de paradas y `unlocated[]`: `resolveStopCoordinates` (`vendix-address-geocoding`).

Verificación: tests del archivo tocado (p. ej. `npm run test:path -w apps/backend -- src/domains/store/dispatch-routes/route-flow/route-flow.service.spec.ts`) y `curl` con usuario seed; ver `how-to-test`.

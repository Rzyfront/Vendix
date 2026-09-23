---
id: I.2
title: "Artefacto de reembolso y cuadre no-efectivo al cancelar"
phase: I
status: in-progress
owner: none
updated: 2026-09-20
contracts: [FB-24, DB-33, DB-34, DB-03, ERR-38]
adrs: [ADR-02]
skills: [vendix-backend, vendix-accounting-rules, vendix-payment-processors, vendix-error-handling, how-to-test]
---
# I.2 — Artefacto de reembolso y cuadre no-efectivo al cancelar

- **Skills:** `vendix-backend` (el cambio vive en `OrderFlowService.cancelOrder` y en el servicio de reembolso ya existente) · `vendix-accounting-rules` (la devolución debe dejar asiento cuadrado y no inventar cuenta PUC) · `vendix-payment-processors` (la reversa por método: efectivo cuadra en caja, tarjeta y transferencia no se revierten solas) · `vendix-error-handling` (el rechazo que deriva al reembolso es tipado) · `how-to-test` (cancelar con pago en efectivo, con tarjeta y sin pago).
- **Resources:** `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:3070` (cancelación) · `:3322` y `:3393-3472` (`registerCancelCashOut`: el tramo de efectivo que sí quedó cerrado, con su escalamiento que no relanza) · `apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts:1944` (el test que fija el vacío no-efectivo como decisión) · `apps/backend/src/domains/store/orders/order-flow/services/refund-flow.service.ts` (`recordRefundCashRegisterMovement`, el carril de devolución al que ADR-02 manda el caso post-cobro) · `apps/backend/src/domains/store/orders/order-flow/services/refund-calculation.service.ts:107` (tope anclado a `grand_total`) · ficha de origen `F-005` (parcialmente cerrada por `626cf9845`) · `F-004` (tope de reembolso): el tope se mantiene anclado a `grand_total` porque I.1 elimina el sobrepago que lo hacía insuficiente.
- **Business decision:** cancelar una orden con pago liquidado **deja siempre un artefacto de reembolso trazable**. Para el efectivo, el egreso de caja que ya se escribe deja de ser el único rastro y pasa a estar respaldado por una fila de `refunds`. Para los métodos no-efectivo, la cancelación **no se consuma en silencio**: o crea el reembolso por su carril, o rechaza con código tipado derivando al reembolso, que es la salida que ADR-02 ya eligió para el caso post-cobro. Cuál de las dos se aplica por método lo fija el paso, y se escribe en el propio servicio, no en un comentario.
- **Why:** hoy hay **cero `refunds.create`** en todo el archivo de flujo de orden: la devolución al cliente no deja ningún artefacto propio, solo el egreso de caja del efectivo. Y los pagos `succeeded` por tarjeta, transferencia o pasarela no generan ninguna reversa al cancelar: ni egreso, ni reembolso, ni marca. El hallazgo se lee como cerrado porque el tramo de efectivo sí se arregló, y el test que existe fija el vacío restante como si fuera una decisión tomada. No lo es: no hay ADR que lo declare.
- **Output:** creación de la fila de `refunds` en el carril de cancelación con pago liquidado, reutilizando el servicio de reembolso existente en vez de escribir una segunda aritmética; el rechazo tipado `ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001` con su mensaje accionable para los métodos que exigen reversa manual; y el spec de `:1944` reescrito para que afirme el artefacto, no su ausencia. **No se reescribe `PaymentGatewayService`**: la reversa con la pasarela queda donde ya vive, y su carril de adopción se acepta como deuda en I.6.
- **Contracts touched:** FB-24, DB-33, DB-34, DB-03, ERR-38
- **Data impact:** escribe ≥1 fila en `refunds` por orden cancelada con pago liquidado, y conserva el `cash_register_movements` de tipo egreso que ya se escribe para el efectivo. Actualiza `orders.total_paid` / `remaining_balance` por el camino que ya los mantiene. Sin migración: `refunds` existe con `state`, `amount` y `refund_method`. Invariante: `orders.state = 'cancelled'` con algún pago `succeeded` ⇒ existe al menos una fila de `refunds` para esa orden.
- **Blast radius:** cancelación de ventas cobradas, cuadre de caja y contabilidad del periodo. Si el reembolso se crea de más —por ejemplo dos veces por reintento— la caja queda con un egreso fantasma y lo nota el cajero al cerrar. Si el rechazo se aplica de más, una cancelación legítima queda bloqueada y el operador no puede cerrar la venta. Si no se crea nada, sigue habiendo dinero devuelto sin rastro y lo nota el contador, tarde y sin poder reconstruirlo.
- **Rollback:** revertir el commit. Las filas de `refunds` ya creadas quedan y son válidas: describen devoluciones que efectivamente ocurrieron. El egreso de caja del efectivo no cambia de conducta en ningún caso, porque ese tramo no se toca.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` — cancelar con pago en efectivo, con tarjeta y sin pago; el caso de `:1944` invertido
  - `curl -s -o evidence/I2-cancel-efectivo.json -w '%{http_code}' -X POST "$API/store/orders/$ORDER_ID/flow/cancel" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"reason":"prueba"}'` → 200
  - mismo `curl` sobre una orden pagada con tarjeta → respuesta esperada según la decisión del paso (reembolso creado, o 409 con `errorCode` `ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001`), evidencia en `evidence/I2-cancel-tarjeta.json`
  - SQL de solo lectura: `SELECT o.id FROM orders o JOIN payments p ON p.order_id = o.id AND p.state = 'succeeded' WHERE o.state = 'cancelled' AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id);` = 0 filas → `evidence/I2-invariante-refunds.txt`
  - SQL de solo lectura: el egreso de caja del efectivo sigue existiendo y no se duplicó → `evidence/I2-caja.txt`
  - `grep -n "refunds" apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` → deja de ser 0
- **Acceptance checklist:**
  - [ ] Cancelar una orden con pago liquidado deja al menos una fila de reembolso trazable, con método y monto
  - [x] El carril no-efectivo deja de consumarse en silencio: rechaza con código tipado
  - [x] El egreso de caja del efectivo conserva su conducta actual y no se duplica por el artefacto nuevo
  - [ ] El tope de reembolso sigue anclado a `grand_total` y ninguna devolución lo supera
  - [ ] El test que fijaba el vacío quedó reescrito para afirmar el artefacto, fijando el `errorCode` en el caso de rechazo
  - [ ] La consulta de invariante de reembolso devuelve cero filas sobre el dataset representativo
  - [ ] El servicio de la pasarela de pago no se modificó en este paso
- **Status:** in-progress — API local: orden #1122 con efectivo y caja QA abierta → 200, reembolso #29 `completed` 10000 y un solo `cash_out` #435; sesión #115 cerrada con diferencia 0 y caja QA #60 desactivada. Transferencia #1118 → 409 `ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001` sin mutación. Sin caja del operador, #1117 canceló con refund #28 `processing` y log/auditoría `no_open_session`; queda pendiente salida operativa. Además, el reembolso estándar solo permite `delivered/finished`, así que una orden transferida en `processing` no tiene salida por el carril al que remite el 409. Decisión solicitada al dueño; evidencia `evidence/I2-*`.

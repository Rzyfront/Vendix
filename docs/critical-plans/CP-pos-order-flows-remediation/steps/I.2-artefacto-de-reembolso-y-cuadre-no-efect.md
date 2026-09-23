---
id: I.2
title: "Artefacto de reembolso y cuadre no-efectivo al cancelar"
phase: I
status: in-progress
owner: none
updated: 2026-09-20
contracts: [FB-24, DB-33, DB-34, DB-03, ERR-38]
adrs: [ADR-02, ADR-12]
skills: [vendix-backend, vendix-accounting-rules, vendix-payment-processors, vendix-error-handling, how-to-test]
---
# I.2 — Artefacto de reembolso y cuadre no-efectivo al cancelar

- **Skills:** `vendix-backend` (el cambio vive en `OrderFlowService.cancelOrder` y en el servicio de reembolso ya existente) · `vendix-accounting-rules` (la devolución debe dejar asiento cuadrado y no inventar cuenta PUC) · `vendix-payment-processors` (la reversa por método: efectivo cuadra en caja, tarjeta y transferencia no se revierten solas) · `vendix-error-handling` (el rechazo que deriva al reembolso es tipado) · `how-to-test` (cancelar con pago en efectivo, con tarjeta y sin pago).
- **Resources:** `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:3070` (cancelación) · `:3322` y `:3393-3472` (`registerCancelCashOut`: el tramo de efectivo que sí quedó cerrado, con su escalamiento que no relanza) · `apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts:1944` (el test que fija el vacío no-efectivo como decisión) · `apps/backend/src/domains/store/orders/order-flow/services/refund-flow.service.ts` (`recordRefundCashRegisterMovement`, el carril de devolución al que ADR-02 manda el caso post-cobro) · `apps/backend/src/domains/store/orders/order-flow/services/refund-calculation.service.ts:107` (tope anclado a `grand_total`) · ficha de origen `F-005` (parcialmente cerrada por `626cf9845`) · `F-004` (tope de reembolso): el tope se mantiene anclado a `grand_total` porque I.1 elimina el sobrepago que lo hacía insuficiente.
- **Business decision:** ADR-12, aprobado por el dueño: cancelar puede cerrar la orden con pago no efectivo realmente recibido, **conservando el pago liquidado** y creando un reembolso pendiente por su monto; no se revierte tarjeta/transferencia/pasarela automáticamente. Efectivo devuelto de inmediato registra egreso y refund completado; en mezcla, solo la parte no efectiva queda pendiente. CxC fiada no cobrada se anula; los abonos reales generan reembolso pendiente. Si hay factura electrónica DIAN aceptada, primero nota crédito. La resolución manual de pendiente a completado exige nota, canal de egreso y referencia/comprobante verificables.
- **Why:** hoy hay **cero `refunds.create`** en todo el archivo de flujo de orden: la devolución al cliente no deja ningún artefacto propio, solo el egreso de caja del efectivo. Y los pagos `succeeded` por tarjeta, transferencia o pasarela no generan ninguna reversa al cancelar: ni egreso, ni reembolso, ni marca. El hallazgo se lee como cerrado porque el tramo de efectivo sí se arregló, y el test que existe fija el vacío restante como si fuera una decisión tomada. No lo es: no hay ADR que lo declare.
- **Output:** cancelación atómica/idempotente con refund por pierna pagada y estado honesto; pago original intacto. Efectivo produce un solo cash-out, no efectivo queda `requested` hasta egreso comprobado. Saldo CxC se anula sin fingir reembolso de dinero no recibido. Gate de nota crédito DIAN antes de mutar. Specs cubren efectivo, tarjeta, transferencia, pasarela, mixto, fiado parcial, retry y rechazo fiscal. No se reescribe `PaymentGatewayService`: no hay reversa automática al cancelar.
- **Contracts touched:** FB-24, DB-33, DB-34, DB-03, ERR-38
- **Data impact:** escribe ≥1 fila en `refunds` por orden cancelada con pago liquidado, y conserva el `cash_register_movements` de tipo egreso que ya se escribe para el efectivo. Actualiza `orders.total_paid` / `remaining_balance` por el camino que ya los mantiene. Sin migración: `refunds` existe con `state`, `amount` y `refund_method`. Invariante: `orders.state = 'cancelled'` con algún pago `succeeded` ⇒ existe al menos una fila de `refunds` para esa orden.
- **Blast radius:** cancelación de ventas cobradas, cuadre de caja y contabilidad del periodo. Si el reembolso se crea de más —por ejemplo dos veces por reintento— la caja queda con un egreso fantasma y lo nota el cajero al cerrar. Si el rechazo se aplica de más, una cancelación legítima queda bloqueada y el operador no puede cerrar la venta. Si no se crea nada, sigue habiendo dinero devuelto sin rastro y lo nota el contador, tarde y sin poder reconstruirlo.
- **Rollback:** revertir el commit. Las filas de `refunds` ya creadas quedan y son válidas: describen devoluciones que efectivamente ocurrieron. El egreso de caja del efectivo no cambia de conducta en ningún caso, porque ese tramo no se toca.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` — cancelar con pago en efectivo, con tarjeta y sin pago; el caso de `:1944` invertido
  - `curl -s -o evidence/I2-cancel-efectivo.json -w '%{http_code}' -X POST "$API/store/orders/$ORDER_ID/flow/cancel" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"reason":"prueba"}'` → 200
  - mismo `curl` sobre una orden pagada con tarjeta → 200, refund `requested`, pago original `succeeded`; evidencia en `evidence/I2-cancel-tarjeta.json`.
  - SQL de solo lectura: `SELECT o.id FROM orders o JOIN payments p ON p.order_id = o.id AND p.state = 'succeeded' WHERE o.state = 'cancelled' AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id);` = 0 filas → `evidence/I2-invariante-refunds.txt`
  - SQL de solo lectura: el egreso de caja del efectivo sigue existiendo y no se duplicó → `evidence/I2-caja.txt`
  - `grep -n "refunds" apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` → deja de ser 0
- **Acceptance checklist:**
  - [ ] Cancelar una orden con pago liquidado deja al menos una fila de reembolso trazable, con método y monto
  - [ ] El carril no-efectivo cancela con refund pendiente trazable, sin afirmar devolución ni mutar pago liquidado.
  - [x] El egreso de caja del efectivo conserva su conducta actual y no se duplica por el artefacto nuevo
  - [ ] El tope de reembolso sigue anclado a `grand_total` y ninguna devolución lo supera
  - [ ] El test que fijaba el vacío afirma ahora el refund pendiente y la idempotencia del reintento.
  - [ ] Mixto devuelve efectivo una vez y deja no-efectivo pendiente; fiado anula CxC no cobrada y reembolsa solo abonos.
  - [ ] Factura DIAN aceptada bloquea sin nota crédito; resolver refund exige comprobante, canal y nota.
  - [ ] La consulta de invariante de reembolso devuelve cero filas sobre el dataset representativo
  - [ ] El servicio de la pasarela de pago no se modificó en este paso
- **Status:** in-progress — evidencia anterior `evidence/I2-*`: efectivo #1122 cerró caja con refund #29 y un solo cash-out; transferencia #1118 recibió 409 (comportamiento **a reemplazar** por ADR-12), #1117 sin caja quedó `processing`. El dueño resolvió no-efectivo, mezcla, CxC, pasarela, comprobante y nota crédito el 2026-09-23. Falta implementar la política nueva y revalidar contabilidad del refund.

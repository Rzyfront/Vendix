---
id: I.1
title: "Validador de sobrepago en el carril `flow/pay`"
phase: I
status: pending
owner: none
updated: 2026-09-20
contracts: [FB-04, DB-02, DB-03, DB-14, ERR-37]
adrs: []
skills: [vendix-backend, vendix-error-handling, vendix-prisma-scopes, how-to-test]
---
# I.1 — Validador de sobrepago en el carril `flow/pay`

- **Skills:** `vendix-backend` (el validador ya existe como servicio; el paso lo cablea, no lo reescribe) · `vendix-error-handling` (fully-paid pasa de `warnings.push` a rechazo tipado con código propio) · `vendix-prisma-scopes` (la suma de pagos se lee con el scope de tienda, nunca por `order_id` a secas) · `how-to-test` (los cuatro carriles de cobro, y el doble clic como caso de fuerza bruta).
- **Resources:** `apps/backend/src/domains/store/payments/services/payment-validator.service.ts:60-66` (`totalPaid >= grand_total` es hoy un warning) · `apps/backend/src/domains/store/payments/payment-validator.service.spec.ts:140-152` (el spec fija ese warning como conducta esperada y hay que invertirlo) · `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:861` (`allowedPayStates` admite `created|shipped|processing`) y `:972-1006` (la rama `shipped` crea un pago por `grand_total` sin mirar los previos) · `apps/backend/src/domains/store/orders/order-flow/order-lifecycle-lock.util.ts` · ficha de origen `F-003` (parcialmente cerrada: el exploit del bypass sí murió en `b4d3b6322`).
- **Business decision:** una orden ya pagada por completo **no se vuelve a cobrar íntegra por ningún carril**. `totalPaid >= grand_total` deja de ser advertencia y pasa a ser rechazo tipado, y `OrderFlowService.payOrder` pasa por el mismo validador que el carril POS antes de crear el pago. Si alguna vez hace falta un segundo cobro legítimo sobre una orden saldada, será por un carril explícito con motivo, no por omisión de validación.
- **Why:** el hallazgo se leía como cerrado y no lo está. El commit que eliminó `skipOrderValidation` cerró que el cliente eligiera qué validaciones corrían, pero dejó dos huecos: el validador sigue tratando fully-paid como advertencia, y `payOrder` **nunca lo llama**. Con `allowedPayStates` admitiendo `processing`, una orden ya saldada que esté en ese estado se cobra otra vez completa, por el importe completo, sin que nada falle. El descuadre resultante es exactamente el que rompe el tope de `RefundCalculationService`, anclado a `grand_total`.
- **Output:** `ORD_PAY_ALREADY_PAID_001` dado de alta en `error-codes.ts` con su 409; la rama fully-paid del validador convertida en error; `payOrder` invocando el validador dentro del lock de ciclo de vida, antes de crear el pago; y el spec `:140-152` invertido para que fije el `errorCode` en vez del texto del warning.
- **Contracts touched:** FB-04, DB-02, DB-03, DB-14, ERR-37
- **Data impact:** none — el paso solo **impide** escrituras: no crea, no actualiza y no borra ninguna fila. Su efecto sobre los datos es negativo por diseño: deja de aparecer el segundo `payments` por el importe completo sobre una orden saldada. Sin migración. El invariante que debe quedar cerrado es `Σ payments succeeded|captured ≤ orders.grand_total` para toda orden no reembolsada.
- **Blast radius:** los cuatro carriles de cobro (POS directo, borrador reabierto, detalle de orden, orden adoptada). Si el rechazo se aplica de más, un abono parcial legítimo o el cobro de una cuota de crédito podría quedar bloqueado y lo nota el cajero con la caja parada. Si se aplica de menos, sigue siendo posible cobrar dos veces y lo nota contabilidad al cierre, como caja sobrante contra una orden con un solo importe.
- **Rollback:** revertir el commit devuelve el warning y deja a `payOrder` sin validador, es decir la conducta de hoy. Sin dato que deshacer; los pagos duplicados anteriores al paso siguen ahí y se identifican con la consulta de verificación.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/payments/payment-validator.service.spec.ts` — el caso de `:150` ahora espera `valid: false` y fija `ORD_PAY_ALREADY_PAID_001`
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` — `payOrder` sobre orden saldada en `created`, `shipped` y `processing`: los tres rechazan
  - `curl -s -o evidence/I1-pay-1.json -w '%{http_code}' -X POST "$API/store/orders/$ORDER_ID/flow/pay" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @pay.json` → 200
  - repetir el mismo `curl` → 409 con `errorCode` `ORD_PAY_ALREADY_PAID_001`, evidencia en `evidence/I1-pay-2.json`
  - abono parcial legítimo sobre orden con saldo: sigue devolviendo 200 → `evidence/I1-abono-parcial.json`
  - SQL de solo lectura: `SELECT p.order_id, SUM(p.amount), o.grand_total FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.state IN ('succeeded','captured') GROUP BY 1, o.grand_total HAVING SUM(p.amount) > o.grand_total + 0.01;` = 0 filas → `evidence/I1-invariante-sobrepago.txt`
- **Acceptance checklist:**
  - [ ] El validador devuelve error, no advertencia, cuando la orden ya está pagada por completo
  - [ ] `payOrder` invoca el validador dentro del lock y antes de crear el pago, en las tres ramas de estado permitidas
  - [ ] El segundo cobro íntegro sobre una orden saldada devuelve 409 tipado y cero filas nuevas en `payments`
  - [ ] Un abono parcial sobre una orden con saldo pendiente sigue aceptándose
  - [ ] El spec que fijaba el warning quedó invertido y ahora fija el `errorCode`, no el texto del mensaje
  - [ ] La consulta de invariante de sobrepago devuelve cero filas sobre el dataset representativo
  - [ ] Evidencia de los tres curl y del SQL guardada bajo `evidence/`
- **Status:** pending

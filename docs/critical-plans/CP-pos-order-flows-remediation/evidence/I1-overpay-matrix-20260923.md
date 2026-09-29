# I.1 — sobrepago: segunda llamada rechazada, abono parcial preservado

QA local 2026-09-23, tienda #10. El guard Decimal fue extraído a `isOrderFullyPaid` en `payment-validator.service.ts` y se reutiliza en `PaymentValidatorService.validateOrder`, el preflight del controlador y `OrderFlowService.payOrder` **después** del claim atómico y **antes** de crear pago. No hace una segunda lectura de BD dentro del claim; valida el snapshot fresco que ya leyó `getOrder`.

- `flow/pay` contra órdenes ya saldadas: `created` #1113, `shipped` #1158 y `processing` #1144 → **409 `ORD_PAY_ALREADY_PAID_001`** en cada caso, una sola fila de pago exitoso por orden sin incremento. Antes, el preflight del controlador ocultaba ese código bajo `ORD_FLOW_PAYMENT_FAILED_001` en shipped/processing; `8b2de5e6f` aplica el guard Decimal de solo lectura antes de la auditoría, dejando el check atómico del servicio como árbitro de carreras.
- Dos POST concurrentes a #1157 → 200+409 `ORD_FLOW_PAYMENT_FAILED_001` en el perdedor, un pago exitoso $10.000. Esto es conflicto de claim, no segundo cobro ya persistido.
- Crédito #1156: abono parcial legítimo $3.000 por `flow/credit-payment` → 200, saldo $7.000 y un pago. Petición sin token 401 y orden de otra tienda 404, sin nueva fila.
- SQL baseline: **10** órdenes sobrepagadas históricas en DB local; consulta con corte temporal separó **0** órdenes sobrepagadas con pago exitoso nuevo. No se corrigió historia, de acuerdo con el Non-Goal del hub.
- Specs: OrderFlowService **118/118**, PaymentValidatorService **24/24** (incluye suma Decimal exacta) y controller preflight **4/4**.

La orden sintética #1159 quedó `created` y sin pagos porque el login del agente recibió 429; no se atribuye a éxito de flujo. El camino de crédito parcial usa el endpoint de crédito del detalle, no `flow/pay` directo; no se afirma un test nuevo de abono normal seguido de pago final.

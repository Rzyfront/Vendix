# B.2/T5 — crédito y confirmación aíslan la proyección (Jest + grep)

T5 implementa los 2 gaps P1 de la auditoría T2. Sin DDL, sin cambios de
semántica de split, sin tocar C.2 ni `registry/err.md`.

## G1 — `flow/credit-payment` proyecta al saldar (no en abonos)

`order-flow.service.ts:4442`: `registerCreditPayment` llama a
`projectPaidOrderToTable(orderId, payment.id)` solo cuando
`newRemainingBalance <= 0.01`, después de pago+saldos+cuotas+caja+eventos
(commits previos). Un fallo de proyección lanza ERR-33 tipado y salta el
`finish` (sin `finished` falso); pago/caja/eventos quedan. La proyección
canónica es idempotente: un reintento posterior de confirm staff la repara
sin duplicar efectos. Specs nuevos (4): saldar proyecta + finish, parcial
no proyecta, fallo → ERR-33 + pago/caja kept + sin finish, cocina
pendiente proyecta sin finish. `order-flow.service.spec.ts`: 135/135.

## G2 — `confirmPayment` no pierde SSE/caja ante fallo de proyección

`table-sessions.service.ts:2580-2595` captura el error de la canónica,
`+`:2655-2660 lo relanza tipado ERR-33 al final, después de SSE
`payment.confirmed`, notificación `table_payment_confirmed` y movimiento
de caja. El pago queda `succeeded`. Spec nuevo (tipado + side effects
intactos) + spec de retry actualizado (primer intento ERR-33, segundo
repara). `table-sessions.service.spec.ts`: 59/59.

## Greps post-cambio

- `markSessionPaid|emitSessionPaid`: solo canónica (`:1647/:1654` + defs)
  y la closure post-commit de POS (`payments.service.ts:902/1380/2035`).
- `closeSession` en `webhook-handler.service.ts`: 0 matches.
- Canónica prod: def `:1622` + confirm `:2587`, split `:550`, POS
  `:1374`, webhook `:634`, helper flow/pay `:1474` (4 call-sites:
  `:1192/:1278/:1396/:4442`).

## Deuda conocida (B.2, sin cambio)

Sesiones que el webhook cerró de más en el pasado no se reabren
(chocaría con `table_sessions_one_open_per_table`); se dejan como están.

## Restante (fuera de T5)

Runtime E-webhook/E-confirm/E-split-confirm/E-credit (curl+SQL),
decisión de dueño D1 (source con split+mesa queda `draft` con
`active_financial_split_id`), G3 (log estructurado webhook) y G4
(`updateOrderStatus` muerto `:555`).

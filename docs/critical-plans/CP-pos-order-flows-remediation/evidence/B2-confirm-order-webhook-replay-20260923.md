# B.2 — Confirmación de orden y replay de webhook (2026-09-23)

## Defecto observado

`POST /store/orders/:id/flow/confirm-payment` convertía un pago pendiente a `succeeded` y avanzaba la orden sin proyectar la sesión abierta a `paid_at`. El webhook tenía una segunda proyección, fuera del confirmador; si fallaba, la absorbía y consumía la clave de deduplicación, por lo que el mismo evento ya no podía reparar la mesa.

## Cambio

- `OrderFlowService.confirmPayment` proyecta después del commit únicamente si `Σ succeeded/captured >= grand_total`. Una confirmación parcial no marca la mesa pagada.
- El replay con orden `processing`/`shipped` y mesa abierta vuelve a intentar la proyección idempotente sin reescribir el pago. Si la mesa ya está cerrada, no la reproyecta.
- Un fallo post-commit conserva el pago, emite los efectos fiscal/estado de la confirmación y devuelve `POS_TABLE_SESSION_PROJECTION_FAILED_001`.
- El webhook deja de duplicar la proyección y propaga ese fallo para liberar la clave de deduplicación; el replay de pago terminal vuelve al confirmador y no repite el efecto monetario.

## Pruebas

- Nuevas pruebas red antes del cambio: confirmación completa y replay de orden procesando no llamaban a la proyección.
- `order-flow-pos-invoice-emission.spec.ts` + `order-flow.service.spec.ts`: **166/166** green, incluyendo completa/parcial/replay/cerrada/fallo post-commit; una expectativa vieja de restauración de claim se actualizó a la escritura CAS real (`where.state='processing'`).
- `webhook-handler.service.spec.ts` + `webhook-handler.shipping-tax.spec.ts`: **31/31** green, incluyendo fallo después del cobro, liberación dedup, replay que repara sin segundo pago y tercer evento deduplicado.
- `git diff --check`: limpio. Docker backend arrancó `API_READY` y `/api/health` devolvió 200.

## Pendiente antes de cerrar B.2

Prueba runtime aislada de confirmación staff, webhook y crédito con mesa propia nueva (no usar mesa 26/sesión 125/orden 1189); verificar SQL `paid_at`, `closed_at`, mesa `occupied`, pagos y SSE. Además quedan revisión de split y concurrencia de `markSessionPaid`.

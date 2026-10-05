---
id: ADR-13
title: "Cancelar una orden reembolsa en el acto todo pago recibido"
status: accepted
reversibility: costly
supersedes: ADR-12 (sección de reembolsos pendientes)
updated: 2026-10-05
---
# ADR-13 — Cancelar una orden reembolsa en el acto todo pago recibido

- **Context:** ADR-12 dejó los pagos no efectivo de una cancelación como `refund` `requested`, cerrables solo con `manuallyResolveRefund` (nota, canal y referencia de egreso). Nadie lo usa. En Pollo Arabe (store 105) los reembolsos #382 ($60.000) y #411 ($59.000), por transferencia, quedaron `requested`, el pago siguió `succeeded` y el cierre de caja continuó contando una transferencia que nunca existió.
- **Decision:** El dueño decide el 2026-10-05 que todo reembolso por anulación se ejecuta y se completa en el acto, sin confirmación y en todo caso. Cada pierna recibida (transferencia, datáfono/tarjeta, voucher, wallet, abono de CxC) nace `processing` dentro de la transacción de `cancelOrder` (reserva techo y cobertura) y su pago pasa a `cancelled`, igual que el efectivo. Tras el commit se completa: `completed` + `processed_at`, historial `refund_resolved`, contra-movimiento de caja `refund`/`order_cancelled` con el método real del pago, y un único `refund.completed` con el `effective_channel` de su método (transferencia → `bank_transfer`; tarjeta/datáfono → `original_payment`/gateway; wallet/voucher → `store_credit` con crédito a la wallet). Las pasarelas con reversa por API (wompi, paypal, stripe) intentan primero la reversa; si falla, lanza o no hay `transaction_id`, el reembolso igual queda `completed` y el fallo se audita (`gateway_reversal_failed`) y se loguea en warn para que el comercio devuelva el dinero por su cuenta. `cash_on_delivery` se trata como efectivo (`CASH_PAYMENT_TYPES`). Ya no se exige referencia de egreso para cerrar la anulación.
- **Consequences:** Un fallo post-commit (pasarela, caja sin sesión, asiento) no revierte la anulación; queda log y auditoría. Sin sesión de caja abierta el contra-movimiento no efectivo se audita, no se encola. La resolución manual (`manuallyResolveRefund`) se conserva para filas históricas `requested`/`pending_approval`/`processing`, como #382 y #411, que se cierran desde la UI cuando la tienda confirme con el banco. Los asientos salen por `refund.completed` (1105/1110/2805) sin cambios en contabilidad.
- **Reversibility:** costly — reembolsos completados, movimientos de caja y asientos son hechos históricos.
- **Revisit if:** el comercio exige confirmación bancaria antes de cerrar, o se implementa reversa por webhook verificable que sustituya el intento síncrono.

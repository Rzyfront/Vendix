---
id: ADR-02
title: "Cancelar un plato entregado se bloquea si la orden ya se cobró"
status: accepted
reversibility: trivial
updated: 2026-09-20
---
# ADR-02 — Cancelar un plato entregado se bloquea si la orden ya se cobró

- **Context:** `cancelDeliveredOrderItem` recalcula `grand_total` restando la línea cancelada (`order-flow.service.ts:2437-2465`). Sus dos guardas de dinero no protegen nada: una lee `orders.payment_status`, columna que no existe en el esquema, y la otra compara contra el estado `'completed'`, que no es valor de `order_state_enum` (`:2326-2328`). Resultado: sobre una orden ya cobrada y `finished`, el total baja por debajo de lo recaudado y queda un descuadre permanente entre `Σ payments succeeded` y `grand_total`. Si además la orden fue facturada, la factura DIAN emitida deja de corresponder a la orden.
- **Decision:** Bloquear. El dueño lo decidió el 2026-09-20 ante las tres alternativas (bloquear · permitir y generar nota crédito · permitir y dejar saldo a favor): *"Bloquear si ya se cobró"*. «Cobrada» se deriva de los pagos reales de la orden, no de una columna de estado. La derivación ya está escrita y con spec propio: `order-cancellation-policy.util.ts` define `SETTLED_PAYMENT_STATES = succeeded | captured | partially_refunded | refunded`. Es literalmente el reemplazo del guard que lee `orders.payment_status`. El rechazo usa código tipado propio, no una excepción genérica.
- **Consequences:** El caso «la mosca cayó en la comida» se resuelve **antes** de cobrar, que es cuando ocurre en la práctica: el mesero cancela el plato, el total baja y el cliente paga lo correcto. Después del cobro el camino es el reembolso existente, no la mutación del total. Las dos guardas muertas se reparan en el mismo paso: repararlas sin cambiar la política ya cierra el agujero. El test de rechazo debe fijar el `errorCode`, no solo el tipo de excepción: `toBeInstanceOf(VendixHttpException)` pasa también con la guarda anterior y daría un verde falso.
- **Reversibility:** trivial — la política vive en una condición; abrirla más tarde (con nota crédito) es aditivo y no invalida nada de lo hecho aquí.
- **Revisit if:** el negocio necesita cancelar platos post-cobro con frecuencia; entonces el camino correcto es nota crédito automática, que es un plan propio por su acoplamiento con DIAN.

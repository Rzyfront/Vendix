---
id: ADR-02
title: "consumir eventos KDS en SSE de ordenes"
status: proposed
reversibility: trivial
updated: 2026-10-06
---
# ADR-02 — consumir eventos KDS en SSE de ordenes

- **Context:** `/store/orders/stream` comparte `NotificationsSseService` por tienda con KDS, pero el cliente de la lista descarta `ticket.*`; el stream no envía snapshot inicial.
- **Decision:** Validar `ticket.order_id` de KDS y `data.order_id` de `order.items.updated`; emitir señal de hidratación separada de estado/creación. Debounce por orden visible, GET por id, y aplicar solo la respuesta más reciente. Al reconectar tras una caída, rehidratar página actual una vez. Si un GET puntual falla mientras el SSE sigue abierto, marcar fila obsoleta, reintentar con límite y ofrecer refresco manual. No abrir segundo EventSource.
- **Consequences:** Estado en vivo sin F5 y sin refrescar cada fila; una pérdida de eventos durante corte se corrige al reconectar. GET por id es más pesado que un resumen dedicado, pero acotado a filas visibles y eventos coalescidos.
- **Reversibility:** trivial — quitar rama de parser y efecto vuelve al comportamiento previo.
- **Revisit if:** La frecuencia de eventos KDS hace costoso el GET puntual, medida en producción; entonces definir endpoint compacto con contrato propio.

---
id: ADR-02
title: "Hidratar la orden nueva por REST en vez de embeber la fila en el SSE"
status: proposed
reversibility: trivial
updated: 2026-09-10
---
# ADR-02 — Hidratar la orden nueva por REST en vez de embeber la fila en el SSE

- **Context:** El evento order.created trae solo order_id, order_number, grand_total y currency. La fila REST trae mesa precomputada, customer_name y numeros normalizados.
- **Decision:** Ante created, hacer GET /store/orders/:id y aplicar la misma normalizacion de loadOrders antes del prepend.
- **Consequences:** Un GET extra por orden nueva; garantiza shape identico y respeta permisos del detalle. Riesgo de storm si pico >10/min: colapsar toasts.
- **Reversibility:** trivial — si el GET falla (404), se descarta el evento sin mutar la lista.
- **Revisit if:** El GET duplica carga medible; entonces embeber snapshot minimo versionado en el evento.

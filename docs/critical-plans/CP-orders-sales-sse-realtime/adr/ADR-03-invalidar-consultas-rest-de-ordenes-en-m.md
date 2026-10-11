---
id: ADR-03
title: "Invalidar consultas REST de ordenes en movil al recibir SSE"
status: proposed
reversibility: trivial
updated: 2026-10-05
---
# ADR-03 — Invalidar consultas REST de ordenes en movil al recibir SSE

- **Context:** Móvil usa `useInfiniteQuery(['orders', search, activeFilter])` y `useQuery(['order-stats'])`; no hay SSE en esa pantalla. El servidor manda identificadores, no filas completas, y no ofrece replay.
- **Decision:** Consumir el stream compartido con `react-native-sse` y, ante `order.created` o `order.status_changed` válidos, invalidar `['orders']` y `['order-stats']` con coalescencia. Revalidar por REST al conectar o volver al primer plano; cerrar la conexión al perder foco, cambiar tienda, cerrar sesión o ir a background. Ante 401, usar la vía REST de renovación JWT o terminar sesión.
- **Consequences:** La página visible y sus filtros se reconstruyen con el contrato REST. Hay consultas extra por ráfaga, mitigadas con coalescencia. Una sola conexión viva por pantalla; el token vigente se lee al abrir cada conexión.
- **Reversibility:** trivial — revertir el consumidor móvil devuelve la pantalla a REST y pull-to-refresh sin migraciones.
- **Revisit if:** El volumen de eventos provoca carga REST medible o se exige actualización con la app cerrada; evaluar eventos agregados o push, respectivamente.

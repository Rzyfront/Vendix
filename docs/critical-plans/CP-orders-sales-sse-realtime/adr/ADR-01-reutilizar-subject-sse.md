---
id: ADR-01
title: "Reutilizar el subject SSE por tienda en vez de crear un stream dedicado"
status: proposed
reversibility: costly
updated: 2026-09-10
---
# ADR-01 — Reutilizar el subject SSE por tienda en vez de crear un stream dedicado

- **Context:** Ya existe GET /store/orders/stream sobre NotificationsSseService (subject por store_id) con auth ?token=, heartbeat 30s y permiso store:orders:read. La alternativa era un stream solo-created.
- **Decision:** No crear endpoint nuevo. Extender el consumidor existente para aceptar order.created junto a order.status_changed.
- **Consequences:** Menos codigo y una sola conexion por vista. El cliente debe discriminar por type y tolerar tipos ajenos (ticket.*, notificaciones).
- **Reversibility:** costly — revertir implica filtrar created de nuevo (1 linea) pero deja el effect de prepend huerfano.
- **Revisit if:** El subject supera 50 eventos/s por tienda o notificaciones contamina la lista pese al filtro.

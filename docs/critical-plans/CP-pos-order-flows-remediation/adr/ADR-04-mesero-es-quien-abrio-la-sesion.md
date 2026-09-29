---
id: ADR-04
title: "El mesero de una mesa es quien abrió la sesión"
status: accepted
reversibility: trivial
updated: 2026-09-20
---
# ADR-04 — El mesero de una mesa es quien abrió la sesión

- **Context:** El dueño pidió ver qué mesero tiene cada mesa. `table_sessions.opened_by` ya guarda el usuario que abrió la sesión. Existe además un objeto `waiter` proyectado en algunas respuestas de mesa (`table-sessions.service.ts`, ~`:1950`), pero **se alimenta del pivote `table_waiters`, no de `opened_by`**: esta decisión reutiliza la forma de ese contrato y le cambia la fuente. La interfaz del frontend (`table.interface.ts:105-129`) tampoco lo declara y ninguna vista lo muestra. La alternativa era introducir `responsible_waiter_id` mutable, que modela el relevo de turno (el mesero de la tarde hereda las mesas de la mañana) a cambio de una migración y de un flujo de traspaso que nadie pidió.
- **Decision:** El mesero mostrado es `opened_by`, resuelto a nombre. El dueño lo decidió el 2026-09-20: *"Quien abrió la sesión"*. Sin columna nueva, sin migración, sin flujo de traspaso.
- **Consequences:** El activo para resolver `opened_by` a nombre ya está escrito y en uso: el `include` de la relación `opener` en `orders.service.ts:1061-1085`, que `order-details-page.component.html:520-525` ya pinta. Se implementa replicando ese `include` en el contrato de mesa y declarando el campo en la interfaz del frontend; el dato ya está escrito en producción para toda sesión existente, así que no hay backfill ni mesas sin mesero. Si el mesero cambia de turno, la mesa sigue mostrando a quien la abrió: es un límite conocido y aceptado, no un defecto. `transferSession` (`:1229-1400`) mueve la sesión entre mesas conservando `opened_by`, lo que es coherente con esta decisión.
- **Reversibility:** trivial — añadir después un responsable mutable es aditivo: `opened_by` se conserva como historia y el nuevo campo se superpone en la proyección.
- **Revisit if:** el negocio empieza a operar con relevo de turnos y la atribución de propinas o comisiones depende de quién atiende, no de quién abrió.

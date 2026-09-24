---
id: ADR-09
title: "La arista delivered-processing es del puente KDS; el resto entra como forzado con motivo"
status: proposed
reversibility: trivial
updated: 2026-09-22
---
# ADR-09 — La arista delivered-processing es del puente KDS; el resto entra como forzado con motivo

- **Context:** La arista `delivered→processing` vive en `VALID_TRANSITIONS` (`order-flow.service.ts:65`) sin guard por llamador, así que un `PATCH /store/orders/:id` genérico recorre la misma transición que el puente KDS (`revertKitchenOrderDelivery`) y `forceOrderState` la audita con `forced: false`: indistinguible en la auditoría de una reversa legítima (AUDIT F-016, parcialmente cerrada por `dfdd47a2d` en el carril masivo). El comentario de la máquina de estados no nombra dueño.
- **Decision:** La arista pertenece al puente KDS, que la recorre sin fricción. Cualquier otro llamador (PATCH genérico, scripts, soporte) solo la recorre como forzado: motivo obligatorio, usuario registrado y `forced: true` en la auditoría. Un forzado sin motivo se rechaza con código tipado. Aplica I.4.
- **Consequences:** F-016 cierra sin cerrar la arista: el puente de cocina conserva su camino y el uso excepcional queda visible y atribuido en vez de camuflado como reversa legítima. Ninguna auditoría histórica se reescribe.
- **Reversibility:** trivial — revertir I.4 devuelve la arista a su estado actual sin tocar datos.
- **Revisit if:** aparece un segundo llamador legítimo recurrente (p. ej. una conciliación automática), en cuyo caso se le nombra como dueño adicional en vez de forzarlo por sistema.

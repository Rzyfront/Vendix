---
id: ADR-07
title: "Reasignar mesa crea sesión nueva y conserva la cerrada como historia"
status: accepted
reversibility: costly
updated: 2026-09-23
---
# ADR-07 — Reasignar mesa crea sesión nueva y conserva la cerrada como historia

- **Context:** El dueño pidió poder devolverle la mesa a una orden cuando un mesero la cerró por equivocación. Hay dos formas: reabrir la sesión cerrada (mutar `closed_at` a null) o abrir una sesión nueva apuntando a la misma orden. La segunda es viable porque `table_sessions.order_id` **no es único**: el esquema ya admite varias sesiones por orden. La primera destruiría el registro de que hubo un cierre, que es justamente el evento que se está corrigiendo, y chocaría con el índice único parcial de una sola sesión abierta por mesa si entretanto alguien abrió otra.
- **Decision:** Abrir una sesión nueva sobre la mesa destino, enlazada a la misma orden, dejando la sesión cerrada intacta como historia inmutable. La elegibilidad se verifica antes: la mesa destino no puede tener sesión abierta, la orden no puede estar cancelada ni reembolsada. El guard `ORD_EDIT_NOT_ALLOWED_001` (`orders.service.ts:1826-1832`) se reformula en el mismo paso para que una orden reasignada siga siendo editable.
- **Consequences:** El índice único parcial `table_sessions_one_open_per_table` impide el peor caso — dos sesiones abiertas en la misma mesa — por construcción de base de datos, no por lógica de aplicación. La auditoría de qué pasó queda completa: se ve el cierre erróneo y la reapertura. Cualquier consumidor que asuma «una sesión por orden» debe enumerarse en el paso; la proyección canónica de ADR-03 debe resolver cuál sesión es la vigente (la abierta; si no hay, la última cerrada).
- **Reversibility:** costly — revertir deja órdenes con más de una sesión que la UI ya no sabe explicar; las filas siguen siendo válidas.
- **Revisit if:** el negocio necesita fusionar el consumo de ambas sesiones en una sola cuenta, lo que exigiría un modelo de cuenta separado de la sesión.

- **Owner approval:** 2026-09-23 — el dueño autorizó expresamente las cuatro propuestas ADR-05/06/07/08 para completar el plan.

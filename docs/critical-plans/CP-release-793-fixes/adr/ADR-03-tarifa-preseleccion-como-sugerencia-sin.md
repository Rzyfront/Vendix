---
id: ADR-03
title: "Tarifa: preseleccion como sugerencia sin bloquear (solo comentario)"
status: accepted
reversibility: trivial
updated: 2026-09-11
---
# ADR-03 — Tarifa: preseleccion como sugerencia sin bloquear (solo comentario)

- **Context:** F-005: el checkout muestra todas las tarifas y preselecciona el mejor match (`postal_code_match`, si no la primera). El comentario rancio prohibe preseleccionar. `canConfirmOrder` sigue exigiendo metodo: no hay bypass.
- **Decision:** Directiva de usuario: NO tocar la logica. Reescribir el comentario para describir la conducta real (sugerencia preseleccionada y cambiable, jamas imposicion) y verificar que el comprador puede elegir otra tarifa sin bloqueo.
- **Consequences:** Cero cambio de runtime; el codigo queda documentado con su intencion real.
- **Reversibility:** trivial — es solo comentario.
- **Revisit if:** Producto pide volver a seleccion explicita obligatoria (entonces si cambia codigo + test E2E).

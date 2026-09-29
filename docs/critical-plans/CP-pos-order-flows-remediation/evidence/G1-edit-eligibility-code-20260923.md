# G.1 — guard de edición y elegibilidad pura (2026-09-23)

ADR-07 fue autorizado por el dueño. Antes, el editor bloqueaba toda orden que tuviera **alguna** sesión cerrada, incluso si otra sesión estaba abierta; `PUT /items` no compartía esa guarda. Ambos escritores usan ahora `assertTableOrderEditable`: sesión abierta vigente permite editar; historial de mesa sin ninguna abierta rechaza `ORD_EDIT_NOT_ALLOWED_001`; orden que nunca tuvo mesa conserva su camino POS normal.

`canReassignOrderToTable` es un util puro para G.2. Rechaza orden `cancelled`/`refunded`, sin historial de mesa, con sesión ya abierta, split activo, pago `succeeded`/`captured`/`partially_refunded`/`refunded`, o factura numerada/emitida (`validated`/`sent`/`accepted`/`rejected`). Permite factura `draft`/`cancelled`/`voided` si no hay otro blocker. Dos errores 409 nuevos; `TABLE_SESSION_NOT_FOUND` 404 se reutiliza.

Pruebas red→green en editor, PUT items y política. `orders.service.spec.ts` + `order-table-reassignment-policy.util.spec.ts`: **126/126** green; `git diff --check` limpio. No hay ruta de reasignación aún: G.2 debe releer todo bajo lock antes de escribir y aportar curl/SQL de una orden con sesión cerrada + nueva abierta.

---
id: B.4
title: "reconciliar estado KDS por SSE"
phase: B
status: in-progress
owner: ejecutor-pequeno
updated: 2026-10-06
contracts: [FB-02, FB-04, DB-01, DB-04, DB-05, ERR-09, ERR-10, ERR-12]
adrs: [ADR-02]
skills: [sopus, vendix-frontend, vendix-zoneless-signals, vendix-restaurant-ops, how-to-test]
---
# B.4 — reconciliar estado KDS por SSE

- **Skills:** sopus, vendix-frontend, vendix-zoneless-signals, vendix-restaurant-ops, how-to-test
- **Resources:** `apps/frontend/src/app/private/modules/store/orders/services/orders-list-sse.service.ts`; `apps/frontend/src/app/private/modules/store/orders/services/orders-list-sse.service.spec.ts`; Playwright MCP
- **Business decision:** Cada `ticket.*` o `order.items.updated` válido actualiza solo la fila visible; reconexión y fallo de GET tienen recuperación.
- **Why:** La lista actual ignora KDS aunque el bus entrega eventos; el estado debe cambiar sin F5.
- **Output:** Parser `ticket.*` y `order.items.updated`, GET puntual coalescido, recuperación de fallo REST y reconciliación tras reconectar.
- **Contracts touched:** FB-02, FB-04, DB-01, DB-04, DB-05, ERR-09, ERR-10, ERR-12
- **Data impact:** none — solo lectura tras eventos.
- **Blast radius:** Eventos ajenos, ráfagas o respuestas tardías podrían pintar estado incorrecto o saturar GET.
- **Rollback:** Revertir rama KDS del parser/efecto; mantener SSE existente de órdenes.
- **Verification:**
  - `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadlessNoSandbox --include=src/app/private/modules/store/orders/services/orders-list-sse.service.spec.ts`
  - Playwright: dos tickets, eventos rápidos, desconexión/reconexión y filtros activos.
- **Acceptance checklist:**
  - [ ] Aceptar `ticket.*` conocido con `ticket.order_id` numérico y `order.items.updated` con `data.order_id`.
  - [ ] No alterar efectos `order.created`/`order.status_changed`.
  - [ ] Coalescer ráfagas por orden, máximo 3 GET simultáneos, ignorar id fuera de página y respuesta obsoleta.
  - [ ] Al reconectar, refrescar página una vez. Si falla GET con SSE abierto, marcar estado obsoleto y ofrecer reintento acotado/manual.
  - [ ] F-003 — SSE omite cambios de items (major)
  - [ ] F-007 — GET fallido deja verde obsoleto (major)
  - [ ] F-010 — SSE de órdenes filtra tickets completos a permiso de lectura (major)
- **Status:** in-progress · ejecutor-pequeno · 2026-10-06

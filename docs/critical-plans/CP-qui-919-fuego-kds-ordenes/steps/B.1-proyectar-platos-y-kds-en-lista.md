---
id: B.1
title: "proyectar platos y KDS en lista"
phase: B
status: in-progress
owner: ejecutor-pequeno
updated: 2026-10-06
contracts: [FB-01, FB-02, DB-01, DB-02, DB-03, DB-04, DB-05]
adrs: [ADR-01]
skills: [sopus, vendix-backend, vendix-prisma-scopes, vendix-restaurant-ops, buildcheck-dev]
---
# B.1 — proyectar platos y KDS en lista

- **Skills:** sopus, vendix-backend, vendix-prisma-scopes, vendix-restaurant-ops, buildcheck-dev
- **Resources:** `apps/backend/src/domains/store/orders/orders.service.ts`; `apps/backend/src/domains/store/orders/orders.service.spec.ts`; `npm run test --workspace=apps/backend -- --runInBand orders.service.spec.ts`
- **Business decision:** La lista debe cargar datos mínimos por página, sin consulta por fila ni estado derivado persistido.
- **Why:** El fuego necesita ids y estados reales antes de ser visible o ejecutable.
- **Output:** Proyección paginada de ítems preparados/tickets y spec de respuesta con scope y reenvío.
- **Contracts touched:** FB-01, FB-02, DB-01, DB-02, DB-03, DB-04, DB-05
- **Data impact:** none — nueva lectura; fire conserva escrituras existentes.
- **Blast radius:** Payload excesivo o relación no scoped puede filtrar pedidos de otra tienda.
- **Rollback:** Revertir solo selección añadida; no hay migración.
- **Verification:**
  - `cd apps/backend && NODE_OPTIONS=--max-old-space-size=4096 npx jest src/domains/store/orders/orders.service.spec.ts --runInBand`
  - `bash scripts/buildcheck.sh --watch`; `curl` lista dev con orden mixta.
- **Acceptance checklist:**
  - [ ] GET paginado incluye campos mínimos y tickets ordenados desc por id.
  - [ ] El mismo ítem puede tener terminal viejo y en vuelo nuevo.
  - [ ] Prisma mantiene scope y una consulta paginada, sin N+1; medir payload/latencia con 50 órdenes, 20 líneas y reenvíos.
  - [ ] DTO de frontend refleja campos opcionales sin inventar estado persistido.
  - [ ] F-009 — Historia KDS sin presupuesto de carga (minor)
- **Status:** in-progress · ejecutor-pequeno · 2026-10-06

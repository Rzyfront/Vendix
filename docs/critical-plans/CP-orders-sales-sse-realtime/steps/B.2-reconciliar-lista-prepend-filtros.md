---
id: B.2
title: "reconciliar lista prepend filtros"
phase: B
status: in-progress
owner: Rafael Eduardo Martinez Frontado
updated: 2026-09-10
contracts: [FB-02, FB-03]
adrs: [ADR-02]
skills: [vendix-frontend, vendix-zoneless-signals, vendix-currency-formatting, how-to-dev]
---
# B.2 — reconciliar lista prepend filtros

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-currency-formatting, how-to-dev
- **Resources:** orders-list.component.ts:590 effect, loadOrders:853, rowClassFn:1007, store-orders.service.ts
- **Business decision:** Prepend solo en pagina 1 sin filtros excluyentes; con filtros activos se muestra toast + badge sin insertar.
- **Why:** Insertar a ciegas rompe paginacion y miente sobre filtros; ignorar siempre hace perder la venta visible.
- **Output:** Effect created que hidrata por GET /:id, normaliza igual que loadOrders y hace prepend dedup con flash.
- **Contracts touched:** FB-02, FB-03
- **Data impact:** none — prepend en memoria; totalItems solo crece ante created propio e hidratado 200.
- **Blast radius:** Paginacion y filtros: un prepend indebido duplica filas o salta de pagina ante el vendedor.
- **Rollback:** Revert del componente; el servicio B.1 queda emitiendo sin consumidor y la lista vuelve a REST.
- **Verification:**
  - npx jest orders-list.component.spec --silent (o spec del servicio si no hay spec de lista)
  - pnpm --filter frontend build 2>&1 | tail -5
- **Acceptance checklist:**
  - [x] GET /:id hidrata y normaliza igual que loadOrders; prepend arriba con dedup
  - [x] Con filtros/pagina>1/sort no-default: toast info, sin insertar (canPrependLiveOrder)
  - [x] Toast success + flash seen via isNewOrder; rafaga >10/min colapsa en resumen
  - [ ] GET 404 descarta sin mutar (ERR-03): codigo listo, E2E pendiente dev arriba
- **Status:** in-progress · Rafael Eduardo Martinez Frontado · 2026-09-10 · codigo listo; falta E2E del item 4

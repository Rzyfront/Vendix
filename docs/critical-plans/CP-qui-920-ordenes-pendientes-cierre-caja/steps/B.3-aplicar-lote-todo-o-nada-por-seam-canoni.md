---
id: B.3
title: "Aplicar lote todo o nada por seam canonico"
phase: B
status: in-progress
owner: none
updated: 2026-10-06
contracts: [FB-12, DB-01, DB-05, DB-06, DB-07, DB-08, ERR-07, ERR-08, ERR-09, ERR-10]
adrs: [ADR-03]
skills: [vendix-bulk-operations, vendix-inventory-stock, vendix-auto-entries, vendix-backend, vendix-error-handling]
---
# B.3 — Aplicar lote todo o nada por seam canonico

- **Skills:** vendix-bulk-operations, vendix-inventory-stock, vendix-auto-entries, vendix-backend, vendix-error-handling
- **Resources:** bash evidence/verify-fb.sh FB-12; npx jest order-flow orders-bulk --runInBand
- **Business decision:** Si se conserva atomicidad del ticket, todas las órdenes elegibles cambian o ninguna; jamás se crea cobro o entrega ficticia.
- **Why:** Un éxito parcial alteraría ventas y dejaría caja ambigua.
- **Output:** Unit of work con lock de sesión/órdenes, revalidación, stock y eventos post-commit/outbox; respuesta de lote idempotente.
- **Contracts touched:** FB-12, DB-01, DB-05, DB-06, DB-07, DB-08, ERR-07, ERR-08, ERR-09, ERR-10
- **Data impact:** Puede finalizar órdenes y registrar stock/COGS sólo tras commit completo.
- **Blast radius:** Un éxito parcial alteraría ventas y dejaría caja ambigua.
- **Rollback:** Feature flag desactiva lote; reconciliar eventos/stock antes de reintentar.
- **Verification:**
  - `npx jest order-flow orders-bulk --runInBand`
- **Acceptance checklist:**
  - [x] Una orden inválida deja todas intactas
  - [x] Carrera de pago/estado devuelve 409 y no cambia otras
  - [x] Reintento no duplica stock, asiento ni SSE
  - [x] Nunca invoca forceOrderState con arista inválida
  - [ ] Se prueba límite de lote y timeout/transacción
  - [x] F-002 — Bulk existente fuerza estados y falla parcialmente (blocker) → evidence/design-audit.md
- **Status:** in-progress

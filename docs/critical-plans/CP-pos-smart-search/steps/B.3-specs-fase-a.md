---
id: B.3
title: "Specs Fase A + scope negativo"
phase: B
status: pending
owner: none
updated: 2026-09-17
contracts: [FB-01, FB-02, DB-01, DB-11, DB-17, ERR-05, ERR-06]
adrs: [ADR-02, ADR-03]
skills: [vendix-backend, vendix-prisma-scopes, vendix-multi-tenant-context]
---
# B.3 — Specs Fase A + scope negativo

- **Skills:** vendix-backend, vendix-prisma-scopes, vendix-multi-tenant-context
- **Resources:** `npm run buildcheck:test -- src/domains/store/products/products.service.spec.ts`
- **Business decision:** Ningún cambio de where/ranking mergea sin specs que fijen el nuevo contrato y el scope tenant; el scope negativo es obligatorio por el riesgo cross-tienda.
- **Why:** Sexto porque fija B.1/B.2 y CIERRA la ventana roja F-052 antes de tocar DB en Fase C; specs verdes son la red para C.3 y el gate mergeable de Fase A.
- **Output:** products.service.spec.ts actualizado (OR tokenizado, fallback, ranking, fail-open, barcode intacto) + test scope negativo tienda B≁A.
- **Contracts touched:** FB-01, FB-02, DB-01, DB-11, DB-17, ERR-05, ERR-06
- **Data impact:** none — solo specs, sin cambios runtime
- **Blast radius:** Solo suite de tests; si un spec fija mal el contrato, Fase C lo hereda (revisar diff con lupa).
- **Rollback:** `git revert` del commit de specs.
- **Verification:**
  - `npm run buildcheck:test -- src/domains/store/products/products.service.spec.ts`
- **Acceptance checklist:**
  - [ ] Specs 646-671 y 1642-1679 asertan AND×OR + fallback + ranking
  - [ ] Test negativo: tienda B no ve productos de tienda A con search
  - [ ] Suite products verde completa (service + controller)
  - [ ] page=-1 documenta shape success:false (ERR-06) sin cambiarlo
  - [ ] Spec barcode positivo con fixture (producto/variante/tier) intacto
- **Status:** pending

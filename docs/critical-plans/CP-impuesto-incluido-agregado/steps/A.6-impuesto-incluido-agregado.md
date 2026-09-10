---
id: A.6
title: "Matriz de regresion fiscal y evidencias"
phase: A
status: in-progress
owner: none
updated: 2026-09-10
contracts: [FB-06, FB-07, DB-03, ERR-03]
adrs: [ADR-02]
skills: [how-to-test, how-to-dev]
---
# A.6 — Matriz de regresión fiscal y evidencias

- **Skills:** how-to-test, how-to-dev
- **Resources:** suites `taxes`, `products`, `products-bulk-edit`, `checkout`, `orders`, `payments`, `invoicing`; `evidence/` del bundle
- **Business decision:** Ningún total histórico cambia: la matriz prueba que agregado == ayer e inclusivo == precio publicado.
- **Why:** Dinero silencioso: un redondeo o una prorrata mal hecha corrompe factura DIAN sin error visible.
- **Output:** Specs nuevos (matriz incluido/agregado/mixto/0%/multi-tasa/prorrata/rescale/herencia) + suites existentes en verde + evidencias en `evidence/`.
- **Contracts touched:** FB-06, FB-07, DB-03, ERR-03.
- **Data impact:** Ninguno (tests con mocks/transacciones rollback).
- **Blast radius:** Cero en prod; si una suite pre-existente falla, se verifica contra base intacta antes de tocar código.
- **Rollback:** N/A (no cambia prod); spec rojo bloquea el PR.
- **Verification:**
  - `npx jest` suites tocadas en verde (taxes, products, bulk-edit, checkout, orders, payments, invoicing)
  - `npx tsc --noEmit` backend + `ng build` frontend
  - `cp-lint.sh` del bundle exit 0 con todos los contratos `[x]`
- **Acceptance checklist:**
  - [ ] Matriz 5 casos (agregado/inclusivo/mixto/0%/multi-tasa) en verde
  - [ ] Specs pre-existentes tocados siguen en verde (o fallo probado pre-existente en base)
  - [ ] Evidencias de conteo backfill, paridad y ERR-01 archivadas en `evidence/`
  - [ ] Typecheck + builds en verde
- **Status:** in-progress

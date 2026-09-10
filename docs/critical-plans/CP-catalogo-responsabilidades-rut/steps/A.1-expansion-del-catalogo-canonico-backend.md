---
id: A.1
title: "Expansion del Catalogo Canonico Backend Casilla 53"
phase: A
status: done
owner: Rafael Eduardo Martinez Frontado
updated: 2026-09-09
contracts: [FB-01, FB-02, FB-04, FB-05, FB-06, FB-07, FB-08, DB-01, DB-02, DB-03, DB-05, ERR-01, ERR-02]
adrs: [ADR-01, ADR-03]
skills: [vendix-backend, vendix-validation, vendix-fiscal-scope]
---
# A.1 — Expansion del Catalogo Canonico Backend Casilla 53

- **Skills:** vendix-backend, vendix-validation, vendix-fiscal-scope
- **Resources:** `npm run buildcheck:test -- src/domains/fiscal-operations/constants/fiscal-responsibilities.catalog.spec.ts`
- **Business decision:** Estado real: canónico 14 códigos, catálogo 7 entradas, versión 2. Llevar ambos a 01-61 vigentes con obligation_types por código, normalizador canónico y versión 3. Códigos desconocidos con forma válida no bloquean (política del validator de clientes).
- **Why:** Sin el canónico ampliado cada DTO estricto responde 400 ante O-05/O-52; sin obligation_types las obligaciones automáticas ignoran los códigos nuevos aunque la UI los muestre.
- **Output:** `fiscal-responsibilities.catalog.ts`, `fiscal-responsibilities.ts` y `normalizeFiscalResponsibilityCode` más spec nuevo del catálogo.
- **Contracts touched:** FB-01, FB-02, FB-04, FB-05, FB-06, FB-07, FB-08, DB-01, DB-02, DB-03, DB-05, ERR-01, ERR-02
- **Data impact:** none — no altera esquemas; amplía valores válidos en arreglos JSONB y TEXT[].
- **Blast radius:** Validación de DTOs en clientes y settings fiscales; generación de obligaciones en FiscalObligationService.
- **Rollback:** Revertir los archivos a la versión anterior con git.
- **Verification:**
  - `npm run buildcheck:test -- src/domains/fiscal-operations/constants/fiscal-responsibilities.catalog.spec.ts`
- **Acceptance checklist:**
  - [x] Ampliar canónico y catálogo a 01-61 vigentes con labels, efectos y obligation_types.
  - [x] Marcar derogadas (35,36,37,38,39,46) como históricas con base legal citada.
  - [x] Implementar y exportar `normalizeFiscalResponsibilityCode` ('48' <-> 'O-48').
  - [x] Incrementar `FISCAL_RESPONSIBILITIES_CATALOG_VERSION` a 3.
  - [x] Sincronizar `KNOWN_TAX_RESPONSIBILITIES` sin `R-99-PJ` (ver A.3 y ADR-04).
  - [x] Declarar cada código nuevo con obligaciones o como informativo.
  - [x] Crear `fiscal-responsibilities.catalog.spec.ts` con casos O-05, O-48, O-52.
- **Status:** done · Rafael Eduardo Martinez Frontado · 2026-09-09

---
id: D.1
title: "Blindaje UBL 2 1 y Verificacion Integral E2E"
phase: D
status: done
owner: none
updated: 2026-09-09
contracts: [FB-01, FB-02, FB-03, FB-04, FB-05, FB-06, FB-07, FB-08, DB-01, DB-02, DB-03, DB-04, DB-05, ERR-01, ERR-02, ERR-03]
adrs: [ADR-01]
skills: [vendix-backend, vendix-tax-typing, vendix-fiscal-scope]
---
# D.1 — Blindaje UBL 2 1 y Verificacion Integral E2E

- **Skills:** vendix-backend, vendix-tax-typing, vendix-fiscal-scope
- **Resources:** `npm run buildcheck:test -- src/domains/store/invoicing/providers/dian-direct/xml/ubl-common.builder.spec.ts`
- **Business decision:** `toDianTaxLevelCode()` sigue siendo el único cortafuegos hacia la lista UBL cerrada; `resolveTaxCodeFromTax` (dimensión tax_type: IVA→01) queda explícitamente intacto y con caso que lo prueba.
- **Why:** Cierra el plan demostrando que el catálogo amplio nunca contamina `cbc:TaxLevelCode` y que nadie confundió responsabilidades RUT con tax_type al ampliar.
- **Output:** Suite en `ubl-common.builder.spec.ts` más sweep de contratos FB, DB y ERR con filas en [x].
- **Contracts touched:** FB-01, FB-02, FB-03, FB-04, FB-05, FB-06, FB-07, FB-08, DB-01, DB-02, DB-03, DB-04, DB-05, ERR-01, ERR-02, ERR-03
- **Data impact:** none — suite de tests y verificación.
- **Blast radius:** Generador de XML para facturas electrónicas, notas débito y crédito.
- **Rollback:** Inmediato mediante git si se detecta contaminación del XML.
- **Verification:**
  - `npm run buildcheck:test -- src/domains/store/invoicing/providers/dian-direct/xml/ubl-common.builder.spec.ts`
- **Acceptance checklist:**
  - [x] Emisor `['O-05','O-16','O-52']` genera `TaxLevelCode>R-99-PN`.
  - [x] Emisor `['O-05','O-13','O-48','O-52']` genera `TaxLevelCode>O-13`.
  - [x] Cliente `['O-05','O-23','O-55']` genera `TaxLevelCode>O-23`.
  - [x] `resolveTaxCodeFromTax` intacto con caso IVA→01 (no confundir dimensiones).
  - [x] Sweep FB, DB y ERR ejecutado con cada fila en [x] y evidencia.
- **Status:** done

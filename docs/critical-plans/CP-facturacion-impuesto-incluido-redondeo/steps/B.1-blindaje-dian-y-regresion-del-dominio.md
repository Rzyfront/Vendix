---
id: B.1
title: "Blindaje DIAN y regresion del dominio"
phase: B
status: done
owner: none
updated: 2026-09-11
contracts: [FB-01, FB-02, DB-01, DB-02, DB-03, ERR-01, ERR-02, ERR-03]
adrs: [ADR-01, ADR-02]
skills: [vendix-tax-typing, vendix-calculated-pricing, vendix-currency-formatting, vendix-backend-api, vendix-error-handling]
---
# B.1 — Blindaje DIAN y regresion del dominio

- **Skills:** vendix-tax-typing, vendix-calculated-pricing, vendix-currency-formatting, vendix-backend-api, vendix-error-handling
- **Resources:** `npx jest src/domains/store/invoicing --runInBand` (workdir `apps/backend`); `npx jest src/domains/store/taxes --runInBand` (workdir `apps/backend`)
- **Business decision:** Cabecera = Σ líneas truncadas (FAU14); línea reconcilia `PriceAmount × cantidad` (FAV06); el 422 frena pre-numeración en creación y pre-firma en emisión (hueco, no quema); todo flujo estándar no tocado sigue idéntico. [Critical decision]
- **Why:** Va tras el fix porque cambia base/cuotas por línea: hay que probar UBL/CUFE/prevalidador y correr la regresión completa del dominio antes de hablar de cierre.
- **Output:** `buildTaxTotals`, `ValImp`/`ValFac`, `dianPriceAmount` y agregaciones verificados; suite invoicing + taxes + print-formats en verde sin esperados reescritos salvo casos del bug.
- **Contracts touched:** FB-01, FB-02, DB-01, DB-02, DB-03, ERR-01, ERR-02, ERR-03
- **Data impact:** none — verificación sobre specs y dataset representativo; sin migración.
- **Blast radius:** XML/CUFE, asientos (tax-matrix), notas crédito/débito, POS; cualquier rojo fuera de los casos del bug detiene el plan.
- **Rollback:** `git revert` de los commits de la fase; si el prevalidador rechaza, se mantiene el test en rojo documentado y no se emite. Periodo mixto aceptado (F-046): entre el deploy y un eventual revert conviven snapshots absorbidos y legacy en el mismo periodo y el tax-matrix los mezcla — es esperado, no corrupción. Facturas inclusivas del intervalo:
  `SELECT DISTINCT i.id, i.invoice_number, i.total_amount, i.created_at FROM invoices i JOIN invoice_items l ON l.invoice_id = i.id WHERE l.is_inclusive = true AND i.created_at BETWEEN '<deploy_at>' AND '<revert_at>' ORDER BY i.id;`
- **Verification:**
  - `npx jest src/domains/store/invoicing --runInBand` en verde (workdir `apps/backend`)
  - `npx jest src/domains/store/taxes --runInBand` en verde (workdir `apps/backend`)
  - `npx jest src/domains/store/print-formats --runInBand` en verde (workdir `apps/backend`)
- **Acceptance checklist:**
  - [ ] UBL/CUFE cuadran con el nuevo redondeo
  - [ ] Suite invoicing verde sin reescrituras ajenas
  - [ ] Suite taxes verde sin reescrituras ajenas
  - [ ] Suite print-formats verde
  - [ ] Rutas de error registradas provocadas y observadas
  - [x] F-003 — Nucleo aritmetico depende de la capa XML (minor)
  - [x] F-016 — POS recalcula impuesto con floats si falta el campo (major)
  - [x] F-017 — POS espera items y la factura trae invoice_items (major)
  - [x] F-020 — Notas parciales evaden el motor y usan floats (major)
  - [x] F-022 — scaleBreakdownToTotal redondea y descuadra partes (minor)
  - [x] F-023 — Escritura de invoice_taxes en dos pasos sin reparar (minor)
  - [x] F-025 — Lookup de related_invoice sin scope previo (note)
  - [x] F-027 — ERR-02 promete pre-numeracion que no existe (major)
  - [x] F-029 — Throws crudos como 500 SYS_INTERNAL_001 (major)
  - [x] F-030 — Frontend sin rama para el codigo nuevo (minor)
  - [x] F-031 — Oraculo cross-tenant de existencia de tarifa (minor)
  - [x] F-038 — tax_type desconocido cambia base de tarifa (minor)
  - [x] F-046 — Rollback deja periodo mixto sin documentar (note)
  - [x] F-053 — Error nuevo anunciado sin mover foco (note)
  - [x] F-055 — 422 nuevo sin copy curada en frontend (blocker)
  - [x] F-056 — Copy Vuelve a guardar es loop muerto (major)
  - [x] F-063 — Sin correlacion espejo contra motor (major)
  - [x] F-051 — Reimpresion pre-fix sin marca de regimen (note)
- **Status:** done · orquestador · 2026-09-11 · commit 428186a8a, regresión 54/54 (53 verde + 2 esperados del bug actualizados)

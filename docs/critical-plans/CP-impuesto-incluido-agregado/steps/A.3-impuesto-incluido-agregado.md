---
id: A.3
title: "Fuente de la verdad en calculo: resolver, vitrina y re-escalado"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [FB-05, FB-06, DB-03, DB-04, DB-06]
adrs: [ADR-02]
skills: [vendix-calculated-pricing, vendix-tax-typing, vendix-backend]
---
# A.3 — Fuente de la verdad en cálculo: resolver, vitrina y re-escalado

- **Skills:** vendix-calculated-pricing, vendix-tax-typing, vendix-backend
- **Resources:** `taxes.service.ts:86`, `storefront-price.service.ts:76,196`, `payments.service.ts:2788`
- **Business decision:** ADR-02: inclusivo no crece el total; el impuesto se despeja (`base=p/(1+r)`, `imp=p−base`, prorrata por tasa); mixto = despejar inclusivo y sumar agregado sobre base neta.
- **Why:** `amount = basePrice*rate` (`:134`) y `net*(1+rate)` (vitrina `:76`) suman siempre; ningún canal lee flag alguno.
- **Output:** `calculateProductTaxes` devuelve por tasa `{rate, amount, is_inclusive, base}` con total sin crecimiento inclusivo; vitrina iguala la fórmula; `rescaleTaxInfo` propaga el flag sin recalcular; `taxes[]` conserva `tax_type` (skill tax-typing, sin regresión de capas).
- **Contracts touched:** FB-05, FB-06, DB-03, DB-04, DB-06.
- **Data impact:** Solo lectura/cálculo; ningún cambio de filas. Productos `false` (mayoría histórica) = fórmula idéntica a hoy.
- **Blast radius:** Todos los totales que consumen el resolver; A.4 cubre los consumidores restantes (orders/checkout/factura).
- **Rollback:** Revert del commit; snapshots históricos ya emitidos no se tocan (skill calculated-pricing).
- **Verification:**
  - spec matriz: agregado 19% sobre 100000 → total 119000; inclusivo 19% sobre 119000 → total 119000, base 100000, imp 19000
  - spec mixto (inclusivo 8% + agregado 19%) iguala `calculateEstimatedPrice()` del modal
  - paridad vitrina vs resolver en mismo producto (diff 0, evidencia `evidence/A.3-paridad.txt`)
- **Acceptance checklist:**
  - [ ] Inclusivo puro: total == precio publicado, desglose despejado por tasa
  - [ ] Agregado puro: fórmula idéntica a la actual (cero regresión)
  - [ ] Mixto iguala el estimado del modal al centavo
  - [ ] `rescaleTaxInfo` conserva flag y montos al reescalar base
  - [ ] F-001 — POS asume agregado: catalogFinalPrice y despeje total en payments (blocker)
  - [ ] F-003 — Verdad como funcion unica resolveLineTotals en taxes (major)
  - [ ] F-004 — Vitrina escalar sincronica no expresa mixto (major)
  - [ ] F-005 — Residuo-mayor-tasa vs truncado DIAN: dos criterios de centavos (major)
  - [ ] F-010 — Snapshot POS con tipo inline pierde el flag (minor)
  - [ ] F-011 — Net-first checkout vs gross-first con ofertas (minor)
  - [ ] F-013 — Modal duplica redondeo; backend no debe igualar al frontend (major)
  - [ ] F-014 — Reutilizar resolveTaxableBase+dianAmount existentes (major)
  - [ ] F-016 — rescaleTaxInfo debe ser re-despeje, no reescalado lineal (major)
- **Status:** done

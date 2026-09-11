---
id: A.2
title: "Resolución multi-zona y jerarquía tolerante en shipping-calculator"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [FB-01, DB-01, DB-02, DB-03, DB-04, ERR-01]
adrs: [ADR-01, ADR-02]
skills: [vendix-backend, vendix-backend-api]
---
# A.2 — Resolución multi-zona y jerarquía tolerante en shipping-calculator

- **Skills:** vendix-backend, vendix-backend-api
- **Resources:** `apps/backend/src/domains/store/shipping/shipping-calculator.service.ts`
- **Business decision:** Resolver todas las zonas coincidentes con la dirección en lugar de una sola zona excluyente, consolidando tarifas por método según especificidad (ADR-01) y otorgando primacía a la coincidencia explícita de ciudad (ADR-02).
- **Why:** Evita que la configuración de tarifas locales para una ciudad específica bloquee o suprima tarifas de métodos nacionales existentes, impidiendo que el comprador quede sin cobertura.
- **Output:** Refactor de `ShippingCalculatorService` en `apps/backend/src/domains/store/shipping/shipping-calculator.service.ts`.
- **Contracts touched:** FB-01, DB-01, DB-02, DB-03, DB-04, ERR-01.
- **Data impact:** none — no modifica esquemas ni muta datos; solo modifica la consulta y agregación en memoria.
- **Blast radius:** Cálculo de tarifas para todas las tiendas en el storefront; mitigado por preservación del shape `ShippingOption[]`.
- **Rollback:** Revertir cambios en `shipping-calculator.service.ts` mediante git.
- **Verification:**
  - `curl -s -X POST "http://localhost:3000/shipping/calculate?store_id=10" ...`
- **Acceptance checklist:**
  - [x] Implementar `resolveMatchingZones` retornando todas las zonas que cubren la dirección
  - [x] Permitir match de ciudad prioritario sobre discrepancia de departamento (ADR-02)
  - [x] Agrupar tarifas por método seleccionando la tarifa de la zona más específica (ADR-01)
  - [x] F-001 — Selección de zona única descarta métodos de zonas más amplias (major)
  - [x] F-002 — Conflicto departamento-ciudad descarta zona a pesar de coincidir la ciudad (major)
  - [x] F-004 — Falta de traza estructurada al descartar zonas o consolidar tarifas (minor)
- **Status:** done

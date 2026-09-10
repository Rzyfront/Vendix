---
id: A.3
title: "Paridad de normalización geográfica en frontend y mapeo checkout"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [FB-01, ERR-02]
adrs: [ADR-02]
skills: [vendix-frontend, vendix-zoneless-signals]
---
# A.3 — Paridad de normalización geográfica en frontend y mapeo checkout

- **Skills:** vendix-frontend, vendix-zoneless-signals
- **Resources:** `apps/frontend/src/app/core/utils/geo-name.util.ts`, `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts`
- **Business decision:** Alinear la normalización geográfica del frontend con la del backend incorporando remoción de artículos iniciales (`LEADING_ARTICLE_PATTERN`), y robustecer el mapeo de nombres de ciudad en checkout.
- **Why:** Garantiza paridad semántica entre el frontend (deduplicación en modales de zona) y el backend (resolución de cotizaciones), evitando inconsistencias al crear o consultar zonas.
- **Output:** Sincronización de `geo-name.util.ts` en frontend y verificación de `matchByName` en `checkout.component.ts`.
- **Contracts touched:** FB-01, ERR-02.
- **Data impact:** none — sin mutaciones de base de datos.
- **Blast radius:** Formularios de configuración de zonas en Store Admin y componente de Checkout en storefront.
- **Rollback:** Revertir cambios en frontend con git.
- **Verification:**
  - `npx ng test --include src/app/core/utils/geo-name.util.spec.ts` o buildcheck del frontend.
- **Acceptance checklist:**
  - [x] Sincronizar `LEADING_ARTICLE_PATTERN` en `apps/frontend/src/app/core/utils/geo-name.util.ts`
  - [x] Verificar que `resolveGeoNames` no envíe IDs crudos cuando la lista de catálogo demore
  - [x] F-003 — Discrepancia en normalización de artículos en frontend respecto a backend (minor)
- **Status:** done

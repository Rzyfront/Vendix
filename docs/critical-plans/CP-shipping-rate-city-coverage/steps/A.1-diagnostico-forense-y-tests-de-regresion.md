---
id: A.1
title: "Diagnóstico forense y tests de regresión de matching geográfico"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: []
adrs: [ADR-02]
skills: [vendix-backend, vendix-backend-api]
---
# A.1 — Diagnóstico forense y tests de regresión de matching geográfico

- **Skills:** vendix-backend, vendix-backend-api
- **Resources:** `apps/backend/src/common/utils/geo-name.util.spec.ts`
- **Business decision:** Fijar mediante pruebas unitarias exhaustivas las reglas de normalización y jerarquía geográfica antes de alterar la lógica del calculador de envíos.
- **Why:** Permite verificar que las mejoras en el matching de ciudades no introduzcan regresiones en el soporte existente para departamentos, prefijos y códigos postales.
- **Output:** Suite de pruebas unitarias extendida en `apps/backend/src/common/utils/geo-name.util.spec.ts`.
- **Contracts touched:** none — paso de pruebas unitarias y diagnóstico sin mutación de contratos.
- **Data impact:** none — sin operaciones de base de datos ni escrituras.
- **Blast radius:** Nulo en runtime; limitado al entorno de pruebas de backend.
- **Rollback:** `git checkout apps/backend/src/common/utils/geo-name.util.spec.ts`
- **Verification:**
  - `npm --prefix apps/backend test geo-name.util.spec.ts`
- **Acceptance checklist:**
  - [x] Reproducir caso de match ciudad con divergencia departamental en spec
  - [x] Reproducir caso de dirección con código postal y variantes de sufijo
  - [x] Ejecutar `npm test geo-name.util.spec.ts` verificando suites en verde
- **Status:** done

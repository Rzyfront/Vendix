---
id: C.1
title: "Diseno en Dos Capas de Responsabilidades en Formulario"
phase: C
status: done
owner: none
updated: 2026-09-09
contracts: [FB-04, FB-05, FB-07, FB-08]
adrs: [ADR-02]
skills: [vendix-frontend, vendix-zoneless-signals, vendix-angular-forms]
---
# C.1 — Diseno en Dos Capas de Responsabilidades en Formulario

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-angular-forms
- **Resources:** `npm run buildcheck:test -- src/app/shared/components/forms/legal-data-form/legal-data-form.component.spec.ts`
- **Business decision:** Dos niveles en `LegalDataFormComponent`: toggles para frecuentes (05, 47, 48, 49, 13, 15, 23, 52) y buscador con chips para el resto; el formulario ya acepta `[catalog]` (línea 584) y solo falta la presentación escalable.
- **Why:** 40+ tarjetas apiladas rompen el wizard en móvil; los 8 frecuentes cubren el 90% de comercios y el buscador conserva el 100% de códigos.
- **Output:** `LegalDataFormComponent` con UI responsiva y ergonómica para el catálogo completo.
- **Contracts touched:** FB-04, FB-05, FB-07, FB-08
- **Data impact:** none — presentación y binding de FormArray/FormControl.
- **Blast radius:** Wizard de activación fiscal y panel de identidad en tiendas y organizaciones.
- **Rollback:** `git checkout HEAD~1 -- apps/frontend/src/app/shared/components/forms/legal-data-form/`
- **Verification:**
  - `npm run buildcheck:test -- src/app/shared/components/forms/legal-data-form/legal-data-form.component.spec.ts`
  - `npm run zoneless:audit`
- **Acceptance checklist:**
  - [x] Toggles directos para las 8 responsabilidades frecuentes.
  - [x] Selector con buscador para responsabilidades secundarias.
  - [x] Chips removibles para seleccionadas del catálogo extendido.
  - [x] Periodicidad de IVA condicionada a O-48 y alerta de exclusión O-48/O-49.
- **Status:** done

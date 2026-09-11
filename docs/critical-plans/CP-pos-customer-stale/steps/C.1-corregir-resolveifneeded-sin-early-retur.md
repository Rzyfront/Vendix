---
id: C.1
title: "Corregir resolveIfNeeded sin early-return ciego"
phase: C
status: pending
owner: none
updated: 2026-09-11
contracts: [FB-01, FB-05, FB-06, ERR-03]
adrs: [ADR-01]
skills: [vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-frontend-component, parallel]
---
# C.1 — Corregir resolveIfNeeded sin early-return ciego

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-frontend-component, parallel
- **Resources:** `apps/frontend/src/app/private/modules/store/pos/components/pos-customer-selector/pos-customer-selector.component.ts:390-457`
- **Business decision:** Lo diligenciado manda: si el form trae email, documento o nombre, siempre se resuelve; short-circuit solo con form vacío.
- **Why:** Va primero en C porque es la raíz: sin este cambio todo lo demás sigue emitiendo A.
- **Output:** `resolveIfNeeded()` sin early-return ciego + test del selector que cubre A-luego-B.
- **Contracts touched:** FB-01, FB-05, FB-06, ERR-03
- **Data impact:** none — cambio solo de código frontend, sin migración.
- **Blast radius:** Si se equivoca, el wizard no avanza o resuelve de más; lo detecta D.1 antes del merge.
- **Rollback:** `git revert <sha del fix>` en develop; solo toca el selector y su spec.
- **Verification:**
  - `npx tsc --noEmit --skipLibCheck apps/frontend/src/app/private/modules/store/pos/components/pos-customer-selector/pos-customer-selector.component.ts`
- **Acceptance checklist:**
  - [ ] Short-circuit solo cuando hay seleccionado Y form vacío
  - [ ] Form diligenciado siempre llama a resolve y emite B
  - [ ] Toast creado/encontrado/actualizado preservado
  - [ ] Spec A-luego-B en verde
  - [ ] F-001 — resolveIfNeeded ignora formulario cuando hay seleccionado (blocker)
- **Status:** pending

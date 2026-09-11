---
id: C.1
title: "Corregir resolveIfNeeded sin early-return ciego"
phase: C
status: done
owner: rzy
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
  - [x] Short-circuit solo cuando hay seleccionado Y form vacío → evidence/post-change-probe.txt
  - [x] Form diligenciado siempre llama a resolve y emite B → probe 5/5 PASS
  - [x] Toast creado/encontrado/actualizado preservado (strings idénticos, R1-G4)
  - [x] Spec A-luego-B + extract en repo (Karma pendiente en E.1, no corrido aquí)
  - [x] F-001 — resolveIfNeeded ignora formulario cuando hay seleccionado (blocker) → evidence/post-change-probe.txt
  - [x] F-002 — selectCustomer no resetea el draft y el click pierde (major) → evidence/post-change-probe-r2.txt
  - [x] F-004 — tipo-doc-solo hacia short-circuit silencioso a A (minor) → evidence/post-change-probe-r2.txt
  - [x] F-008 — reset en modo factura minima muestra buscador general (minor) → evidence/r2-fixes.txt
- **Status:** done · rzy · 2026-09-11 · evidence/post-change-probe-r2.txt

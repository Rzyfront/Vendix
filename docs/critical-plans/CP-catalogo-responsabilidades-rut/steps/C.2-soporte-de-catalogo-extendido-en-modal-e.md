---
id: C.2
title: "Soporte de Catalogo Extendido en Modal Escaneo RUT"
phase: C
status: done
owner: none
updated: 2026-09-09
contracts: [FB-03]
adrs: [ADR-02, ADR-03]
skills: [vendix-frontend, vendix-zoneless-signals]
---
# C.2 — Soporte de Catalogo Extendido en Modal Escaneo RUT

- **Skills:** vendix-frontend, vendix-zoneless-signals
- **Resources:** `npm run buildcheck:test -- src/app/shared/components/fiscal-activation-wizard/components/rut-scanner-modal.component.spec.ts`
- **Business decision:** El modal muestra labels via `getFiscalResponsibilityLabel()`, normaliza cada código antes de `confirmed.emit()` y crea su spec (hoy no existe); el backend ya normaliza `confidence`, fuera de alcance aquí.
- **Why:** Sin normalizar en el borde, un '48' del escáner viaja crudo al formulario y los helpers de IVA no lo reconocen; el spec nuevo fija el comportamiento.
- **Output:** `rut-scanner-modal.component.ts` con vista previa enriquecida y `rut-scanner-modal.component.spec.ts` nuevo.
- **Contracts touched:** FB-03
- **Data impact:** none — componente modal.
- **Blast radius:** Flujo de escaneo con IA en onboarding y panel de configuración fiscal.
- **Rollback:** `git checkout HEAD~1 -- apps/frontend/src/app/shared/components/fiscal-activation-wizard/components/rut-scanner-modal.component.ts`
- **Verification:**
  - `npm run buildcheck:test -- src/app/shared/components/fiscal-activation-wizard/components/rut-scanner-modal.component.spec.ts`
- **Acceptance checklist:**
  - [x] Badges del paso de revisión con `getFiscalResponsibilityLabel`.
  - [x] Normalizar cada `tax_responsibilities` antes de emitir en `onConfirm()`.
  - [x] Caso '05','14','48','52' pinta badges sin errores.
  - [x] Crear el spec del modal con los tres casos anteriores.
- **Status:** done

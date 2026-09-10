---
id: B.2
title: "Inyeccion de Catalogo en Tab Identidad Fiscal"
phase: B
status: done
owner: none
updated: 2026-09-09
contracts: [FB-01, FB-02, FB-04]
adrs: [ADR-02]
skills: [vendix-frontend, vendix-zoneless-signals]
---
# B.2 — Inyeccion de Catalogo en Tab Identidad Fiscal

- **Skills:** vendix-frontend, vendix-zoneless-signals
- **Resources:** `docker logs vendix_frontend | grep -E "Compiled|error"`
- **Business decision:** Replicar en `FiscalIdentityPanelComponent` el patrón que ya funciona en el wizard (`fiscal-legal-data-step.component.ts:96,197,262`): cargar con `getResponsibilitiesCatalog(apiScope)` y pasar `[catalog]="catalog()"`, con fallback al espejo local si es null.
- **Why:** El panel monta `<app-legal-data-form>` sin `[catalog]`, así que usa el fallback fijo de 7 códigos; el wizard demuestra que la inyección dinámica funciona y es el molde a copiar.
- **Output:** `fiscal-identity-panel.component.ts` inyectando el catálogo activo al formulario legal.
- **Contracts touched:** FB-01, FB-02, FB-04
- **Data impact:** none — cambios de enlace en plantilla y estado en componente Angular.
- **Blast radius:** Tab "Identidad" del Centro Fiscal.
- **Rollback:** `git checkout HEAD~1 -- apps/frontend/src/app/private/modules/fiscal-operations/components/fiscal-identity-panel.component.ts`
- **Verification:**
  - `docker logs vendix_frontend | grep "Compiled successfully"`
- **Acceptance checklist:**
  - [x] Añadir señal `catalog` y carga con `getResponsibilitiesCatalog(apiScope)`.
  - [x] Vincular `[catalog]="catalog()"` en `<app-legal-data-form>` del panel.
  - [x] Conservar fallback local cuando el catálogo aún es null.
  - [x] Validar hidratación sin re-renders cíclicos (señal solo se escribe al resolver).
- **Status:** done

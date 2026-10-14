---
id: B.3
title: "Abrir y cerrar sesión de atención"
phase: B
status: done
owner: Andres Meza
updated: 2026-10-14
contracts: [FB-13, FB-14, FB-15, DB-08, DB-09, DB-11, DB-16, ERR-05, ERR-06, ERR-07]
adrs: [ADR-01, ADR-02]
skills: [vendix-backend, vendix-backend-api, vendix-permissions, vendix-date-timezone]
---
# B.3 — Abrir y cerrar sesión de atención

- **Skills:** vendix-backend, vendix-backend-api, vendix-permissions, vendix-date-timezone
- **Resources:** curl lifecycle; npx jest service-sessions --runInBand
- **Business decision:** Una estación sólo tiene una sesión activa; cliente y objeto atendido son mínimos según servicio.
- **Why:** Puede mezclar trabajos de clientes en misma silla.
- **Output:** Sesión ligada a booking y order, estado, hitos y auditoría; manejo de walk-in.
- **Contracts touched:** FB-13, FB-14, FB-15, DB-08, DB-09, DB-11, DB-16, ERR-05, ERR-06, ERR-07
- **Data impact:** Crea sesión, sujeto y eventos; enlaza orden existente o nueva.
- **Blast radius:** Puede mezclar trabajos de clientes en misma silla.
- **Rollback:** Desactivar aperturas; cerrar/reconciliar sesiones inconsistentes con auditoría.
- **Verification:**
  - `npx jest service-sessions --runInBand`
- **Acceptance checklist:**
  - [x] Abrir dos veces devuelve conflicto → evidence/d1-database-exclusion-validation-20261014.md
  - [x] Walk-in usa horizonte extensible y respeta próxima cita de estación/proveedor → evidence/implementation-notes.md
  - [x] Vehículo opcional en barbería → evidence/business-analysis.md
  - [x] Cierre libera estación y revoca permisos según regla → evidence/implementation-notes.md
  - [x] Pausa, no-show, extensión y cambio de proveedor tienen transición y liberación de intervalo definidas → evidence/implementation-notes.md
- **Status:** done · 2026-10-14

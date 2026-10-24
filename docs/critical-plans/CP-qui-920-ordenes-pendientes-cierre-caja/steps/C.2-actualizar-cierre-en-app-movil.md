---
id: C.2
title: "Actualizar cierre en app movil"
phase: C
status: in-progress
owner: none
updated: 2026-10-06
contracts: [FB-01, FB-02, FB-04, FB-05, FB-11, FB-12, FB-16, ERR-01, ERR-02, ERR-03, ERR-05, ERR-11]
adrs: [ADR-02, ADR-03]
skills: [mobile-dev, vendix-ui-ux, vendix-error-handling]
---
# C.2 — Actualizar cierre en app movil

- **Skills:** mobile-dev, vendix-ui-ux, vendix-error-handling
- **Resources:** npx tsc --noEmit -p apps/mobile/tsconfig.json; prueba Expo en iOS/Android
- **Business decision:** Móvil muestra pendientes, preview y saldo fresco; permite continuar con pendientes por estado o saldo tras modal de advertencia. Una sesión sin pendientes no muestra aviso, aunque sea legacy sin tracking.
- **Why:** Una versión móvil vieja podría quedar bloqueada o saltar confirmación.
- **Output:** Servicio y modal Expo con estado accesible, paginación/lista y manejo de 409, sin cierre silencioso.
- **Contracts touched:** FB-01, FB-02, FB-04, FB-05, FB-11, FB-12, FB-16, ERR-01, ERR-02, ERR-03, ERR-05, ERR-11
- **Data impact:** none — UI móvil
- **Blast radius:** Una versión móvil vieja podría quedar bloqueada o saltar confirmación.
- **Rollback:** Coordinar release/feature flag por versión mínima; conservar cierre manual auditado si app vieja.
- **Verification:**
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`
- **Acceptance checklist:**
  - [ ] Móvil usa expected_closing_amount_seen
  - [ ] Ve contador, saldo y elegibilidad de órdenes de sesión actual
  - [ ] VoiceOver/TalkBack anuncia banner, filas, estado y 409; tap targets/foco/teclado accesibles
  - [ ] Modal de advertencia con icono grande permite volver o cerrar con pendientes; no pide motivo escrito
  - [ ] 409 refresca pendiente y efectivo
  - [ ] Versión vieja recibe mensaje accionable sin saltar guard
  - [x] F-005 — Mobile omite snapshot esperado (major) → evidence/design-audit.md
- **Status:** in-progress

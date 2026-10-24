---
id: D.1
title: "Verificar contratos concurrencia y despliegue"
phase: D
status: in-progress
owner: none
updated: 2026-10-08
contracts: [FB-01, FB-02, FB-03, FB-04, FB-05, FB-06, FB-07, FB-08, FB-09, FB-10, FB-11, FB-12, FB-13, FB-14, FB-15, FB-16, FB-17, FB-18, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-08, DB-09, DB-10, DB-11, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07, ERR-08, ERR-09, ERR-10, ERR-11, ERR-12, ERR-13]
adrs: [ADR-01, ADR-02, ADR-03]
skills: [how-to-test, buildcheck-dev, vendix-prisma-migrations, git-workflow]
---
# D.1 — Verificar contratos concurrencia y despliegue

- **Skills:** how-to-test, buildcheck-dev, vendix-prisma-migrations, git-workflow
- **Resources:** bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-qui-920-ordenes-pendientes-cierre-caja; builds web/backend/mobile
- **Business decision:** Ninguna tienda se activa sin migración representativa, contratos reales, lote todo-o-nada y UX web/móvil.
- **Why:** Fallo silencioso financiero o cross-tenant tras deploy.
- **Output:** Scripts evidence/verify-{fb,db,err}.sh, matrices de dos tiendas, cargas, logs, piloto, rollback y auditoría adversarial.
- **Contracts touched:** FB-01, FB-02, FB-03, FB-04, FB-05, FB-06, FB-07, FB-08, FB-09, FB-10, FB-11, FB-12, FB-13, FB-14, FB-15, FB-16, FB-17, FB-18, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-08, DB-09, DB-10, DB-11, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07, ERR-08, ERR-09, ERR-10, ERR-11, ERR-12, ERR-13
- **Data impact:** Ejecuta fixtures/reconciliación; no usa datos productivos para prueba destructiva.
- **Blast radius:** Fallo silencioso financiero o cross-tenant tras deploy.
- **Rollback:** Apagar lote/alerta con guard seguro, conservar evidencia, revertir app y conciliar.
- **Verification:**
  - `bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-qui-920-ordenes-pendientes-cierre-caja`
  - `VENDIX_LOCAL_RACE_TEST=1 npm run test:path -- src/domains/store/cash-registers/sessions/qui920-deferred-cash-close-race.integration.spec.ts` (requires loopback PostgreSQL via `VENDIX_LOCAL_RACE_DATABASE_URL`)
- **Acceptance checklist:**
  - [ ] Cada fila FB/DB/ERR tiene script ejecutado y evidencia
  - [ ] Carrera orden/movimiento nuevo versus cierre no omite pendiente ni efectivo
  - [ ] Lote fallido no deja estado/stock/asiento parcial
  - [ ] Snapshot de cierre no muta tras pago posterior
  - [ ] 13 perspectivas y dos rondas limpias tras implementación
- **Status:** in-progress

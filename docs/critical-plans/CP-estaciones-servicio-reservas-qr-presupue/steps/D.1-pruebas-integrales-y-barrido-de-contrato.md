---
id: D.1
title: "Pruebas integrales y barrido de contratos"
phase: D
status: done
owner: big-model
updated: 2026-10-14
contracts: [FB-01, FB-22, FB-23, FB-24, FB-25, FB-47, FB-48, FB-26, FB-27, FB-28, FB-29, FB-30, FB-31, FB-32, FB-33, FB-34, FB-35, FB-36, FB-37, FB-38, FB-39, FB-40, FB-41, FB-42, FB-43, FB-44, FB-45, FB-46, DB-01, DB-18, DB-19, DB-20, ERR-01, ERR-15, ERR-16, ERR-17, ERR-18, ERR-19, ERR-20, ERR-21]
adrs: [ADR-01, ADR-02, ADR-03, ADR-04]
skills: [how-to-test, buildcheck-dev, vendix-error-handling, vendix-prisma-migrations]
---
# D.1 — Pruebas integrales y barrido de contratos

- **Skills:** how-to-test, buildcheck-dev, vendix-error-handling, vendix-prisma-migrations
- **Resources:** npm run build --workspace=apps/backend; npm run build --workspace=apps/frontend; cp-context.sh sweep
- **Business decision:** No se libera con contratos incompletos, 500 crudos o races sin cubrir.
- **Why:** Un build verde ocultaría payload roto o fuga de privacidad.
- **Output:** Crear harness `evidence/verify-{fb,db,err}.sh` parametrizado por ID; evidenciar cada FB/DB/ERR, concurrencia, accesibilidad y dos tiendas.
- **Contracts touched:** FB-01, FB-22, FB-23, FB-24, FB-25, FB-47, FB-48, FB-26, FB-27, FB-28, FB-29, FB-30, FB-31, FB-32, FB-33, FB-34, FB-35, FB-36, FB-37, FB-38, FB-39, FB-40, FB-41, FB-42, FB-43, FB-44, FB-45, FB-46, DB-01, DB-18, DB-19, DB-20, ERR-01, ERR-15, ERR-16, ERR-17, ERR-18, ERR-19, ERR-20, ERR-21
- **Data impact:** Datos de prueba y reversión limpia en clon.
- **Blast radius:** Un build verde ocultaría payload roto o fuga de privacidad.
- **Rollback:** Bloquear release y conservar versión previa.
- **Verification:**
  - `bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-estaciones-servicio-reservas-qr-presupue`
- **Acceptance checklist:**
  - [x] Cada fila de registros ejecuta su script por ID con respuesta real y evidencia
  - [x] Dos tiendas y token caducado se prueban
  - [x] Concurrencia 100 intentos sin solape y carga calendario acotada
  - [x] Pruebas de checkout fallido y stock no reservado
  - [x] 13 perspectivas y dos rondas limpias
- **Status:** done

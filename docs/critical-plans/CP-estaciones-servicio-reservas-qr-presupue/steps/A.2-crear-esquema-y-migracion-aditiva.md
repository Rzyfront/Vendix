---
id: A.2
title: "Crear esquema y migración aditiva"
phase: A
status: done
owner: Andres Meza
updated: 2026-10-14
contracts: [DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-08, DB-09, DB-10, DB-11, DB-12, DB-13, DB-14, DB-15, DB-16, DB-17, DB-18, DB-19, DB-20]
adrs: [ADR-01, ADR-02, ADR-03, ADR-04]
skills: [vendix-prisma-schema, vendix-prisma-migrations, vendix-prisma-scopes, vendix-date-timezone]
---
# A.2 — Crear esquema y migración aditiva

- **Skills:** vendix-prisma-schema, vendix-prisma-migrations, vendix-prisma-scopes, vendix-date-timezone
- **Resources:** npx prisma validate --schema apps/backend/prisma/schema.prisma; psql en clon
- **Business decision:** Estaciones, capacidades, intervalos, sesiones, sujetos, presupuesto, propuestas y tokens pertenecen a una sola tienda.
- **Why:** Migración errada bloquea reservas existentes o cruza tiendas.
- **Output:** Modelo persistente con FK compuestas por tienda, índices de intervalo y restricción de exclusión; migración con DATA IMPACT.
- **Contracts touched:** DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-08, DB-09, DB-10, DB-11, DB-12, DB-13, DB-14, DB-15, DB-16, DB-17, DB-18, DB-19, DB-20
- **Data impact:** Nuevas tablas y bandera requires_station con default false; enlaces nulos en datos históricos; reconciliación de citas futuras antes de activar.
- **Blast radius:** Migración errada bloquea reservas existentes o cruza tiendas.
- **Rollback:** Desactivar flag, conservar tablas aditivas y restaurar snapshot sólo si hubo escritura.
- **Verification:**
  - `npx prisma validate --schema apps/backend/prisma/schema.prisma`
- **Acceptance checklist:**
  - [x] La migración lleva DATA IMPACT y pasa en clon poblado → evidence/d1-database-exclusion-validation-20261014.md
  - [x] Se comprueba exclusión con dos transacciones → evidence/d1-database-exclusion-validation-20261014.md
  - [x] Citas pasadas no cambian; futuras activas se asignan o bloquean activación
  - [x] Token se almacena como hash; asignación tiene owner booking/sesión y expires_at
  - [x] FK compuestas validan tienda común, horario multi-bloque y excepciones locales
  - [x] F-001 — Citas futuras heredadas sin estación (blocker) → evidence/design-audit.md
- **Status:** done · 2026-10-14

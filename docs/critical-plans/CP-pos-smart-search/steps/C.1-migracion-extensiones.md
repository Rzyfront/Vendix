---
id: C.1
title: "Migración extensiones pg_trgm + unaccent"
phase: C
status: pending
owner: none
updated: 2026-09-17
contracts: [DB-13, DB-14]
adrs: [ADR-01, ADR-04]
skills: [vendix-prisma-schema, vendix-prisma-migrations]
---
# C.1 — Migración extensiones pg_trgm + unaccent

- **Skills:** vendix-prisma-schema, vendix-prisma-migrations
- **Resources:** `npx prisma migrate dev --name pos_search_extensions`
- **Business decision:** Extensiones aditivas idempotentes + wrapper immutable_unaccent + reglas custom preservando ñ/Ñ (precisión español); orden deploy: migraciones ANTES que código, TRIGRAM default-off + capability guard backstop.
- **Why:** Séptimo porque Fase B de DB va tras Fase A gateada (E.2); M1 antes que M2 porque el índice depende del wrapper.
- **Output:** Migración XXXX_pos_search_extensions (EXTENSION pg_trgm/unaccent + wrapper + reglas ñ + DATA IMPACT) + runbook orden deploy + specs disponibilidad.
- **Contracts touched:** DB-13, DB-14
- **Data impact:** Tablas: ninguna (solo pg_extension + 1 función); filas: 0; destructivo: ninguno; FK: ninguno.
- **Blast radius:** Global a la DB pero aditivo; si prod gestionado niega CREATE EXTENSION, Fase B se bloquea (verificar permisos en staging idéntico primero).
- **Rollback:** `DROP EXTENSION IF EXISTS` + drop wrapper (solo si nada los referencia); migración Prisma marcada resuelta.
- **Verification:**
  - `SELECT * FROM pg_available_extensions WHERE name IN ('pg_trgm','unaccent'); SELECT extname FROM pg_extension;`
- **Acceptance checklist:**
  - [ ] Header DATA IMPACT en migration.sql (0 filas, sin FK, idempotente)
  - [ ] unaccent('café')='cafe' y wrapper marcado IMMUTABLE en staging
  - [ ] Permisos CREATE EXTENSION confirmados en entorno igual a prod
  - [ ] `npx prisma migrate status` limpio tras aplicar
  - [ ] unaccent('niño')='niño' (ñ preservada por reglas custom)
  - [ ] Runbook orden deploy firmado: migrate→deploy, mid-migración sirve legacy
  - [ ] F-050 — Orden deploy código-vs-migración sin fijar (major)
  - [ ] F-079 — unaccent default colapsa ñ→n sin decisión (minor)
- **Status:** pending

---
id: C.2
title: "Migración GIN trigram CONCURRENTLY"
phase: C
status: pending
owner: none
updated: 2026-09-17
contracts: [DB-12, DB-16]
adrs: [ADR-01, ADR-04]
skills: [vendix-prisma-schema, vendix-prisma-migrations]
---
# C.2 — Migración GIN trigram CONCURRENTLY

- **Skills:** vendix-prisma-schema, vendix-prisma-migrations
- **Resources:** `psql $DATABASE_URL -f XXXX_pos_search_trgm_idx.sql && npx prisma migrate resolve --applied XXXX_pos_search_trgm_idx`
- **Business decision:** 1 GIN por expresión canónica (name, sku); archivo solo-CONCURRENTLY aplicado vía runbook (no `migrate dev`); drift documentado; description con rama OR aparte (F-027); gates numéricos.
- **Why:** Octavo porque el índice necesita C.1; antes de C.3 porque el raw lo usa; runbook verificado contra precedente 20260914170851.
- **Output:** Migración XXXX_pos_search_trgm_idx (GIN expresión name + GIN expresión sku + DATA IMPACT) + runbook dual: local-dev vía psql+resolve (migrate dev SÍ envuelve en tx) vs deploy vía migrate deploy (SÍ aplica CONCURRENTLY sin tx — memoria #2085, PR #811) + benchmark import + VACUUM/pending-list + teardown.
- **Contracts touched:** DB-12, DB-16
- **Data impact:** Tablas: products (solo índices); filas mutadas: 0; bloqueo: ninguno (CONCURRENTLY); FK: ninguno.
- **Blast radius:** Build acapara I/O en ventana medida; imports masivos frenan (write-amp GIN); pending-list decae search post-import hasta VACUUM.
- **Rollback:** Teardown dueño: `DROP INDEX CONCURRENTLY` name+sku; INVALID→REINDEX CONCURRENTLY (nunca retry IF NOT EXISTS); `migrate resolve` si aplica.
- **Verification:**
  - `SELECT indexname FROM pg_indexes WHERE tablename='products'; SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`
- **Acceptance checklist:**
  - [ ] Runbook = aplicación real del precedente (verificado en _prisma_migrations/logs)
  - [ ] Post-deploy: gate falla si EXISTS indisvalid=false
  - [ ] Build ≤30min + GIN ≤3x tabla en clon staging mayor tenant (gate, no aviso)
  - [ ] Import 10k bench con/sin índice + runbook VACUUM post-imports documentados
  - [ ] F-002 — GIN compuesto inválido: integer sin opclass GIN (blocker)
  - [ ] F-031 — CONCURRENTLY no corre en transacción Prisma (major)
  - [ ] F-048 — Costo GIN medio-presupuestado: build/imports/pending-list (major)
  - [ ] F-082 — INVALID retry mal documentado en DB-16 (minor)
- **Status:** pending

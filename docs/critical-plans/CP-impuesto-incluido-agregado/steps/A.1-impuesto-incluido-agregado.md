---
id: A.1
title: "Migracion is_inclusive en product_tax_assignments con backfill"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [DB-01]
adrs: [ADR-01, ADR-03]
skills: [vendix-prisma-migrations, vendix-prisma-schema]
---
# A.1 — Migración is_inclusive en product_tax_assignments con backfill

- **Skills:** vendix-prisma-migrations, vendix-prisma-schema
- **Resources:** `apps/backend/prisma/schema.prisma:1732`, `apps/backend/prisma/migrations/`, `npm run db:migrate:dev -w apps/backend`
- **Business decision:** ADR-01 (verdad por asignación) + ADR-03 (catálogo como default heredado, no switch).
- **Why:** Sin columna no hay dónde persistir el toggle de detalle/masiva; es el eslabón roto probado en `schema.prisma:1732`.
- **Output:** Migración `20260910XXXXXX_tax_assignment_inclusive/migration.sql` + schema actualizado + cliente regenerado.
- **Contracts touched:** DB-01.
- **Data impact:** ADD COLUMN `is_inclusive BOOLEAN NOT NULL DEFAULT FALSE` (aditiva, sin locks largos); backfill `UPDATE ... SET is_inclusive=true WHERE tax_category_id IN (SELECT id FROM tax_categories WHERE is_inclusive)` con WHERE (prohibido sin WHERE); header `-- DATA IMPACT:` obligatorio.
- **Blast radius:** Solo DDL + backfill; histórico sin catálogo inclusivo queda `false` = comportamiento actual (cero cambio de totales).
- **Rollback:** Nueva migración que dropea la columna (aprobación mediante); datos de asignaciones intactos.
- **Verification:**
  - `npm run db:migrate:dev -w apps/backend` en verde
  - `SELECT COUNT(*) FROM product_tax_assignments WHERE is_inclusive` == conteo con catálogo inclusivo (evidencia en `evidence/A.1-backfill-count.txt`)
  - `npx prisma generate -w apps/backend` expone el campo
- **Acceptance checklist:**
  - [ ] SQL idempotente (`ADD COLUMN IF NOT EXISTS`, `WHERE` en UPDATE, header DATA IMPACT)
  - [ ] Backfill verificado por conteo contra `tax_categories.is_inclusive`
  - [ ] `cp-lint.sh` del bundle en verde tras registrar la migración en DB-01
  - [ ] F-012 — Triple default: backfill categoria vs frontend categoria??tasa (blocker)
  - [ ] F-033 — Backfill tenant-scoped con join + caza huerfanos (major)
- **Status:** done

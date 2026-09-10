---
id: A.2
title: "DTOs y persistencia del mapa incluido-agregado en productos"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [FB-01, FB-02, DB-02, ERR-01]
adrs: [ADR-01]
skills: [vendix-backend, vendix-backend-api, vendix-validation, vendix-error-handling]
---
# A.2 — DTOs y persistencia del mapa incluido/agregado en productos

- **Skills:** vendix-backend, vendix-backend-api, vendix-validation, vendix-error-handling
- **Resources:** `dto/index.ts:678,1134`, `products.service.ts:884,1001,1031,2057,1180`
- **Business decision:** El mapa del modal deja de descartarse: cada `tax_category_id` guarda su flag; sin entrada rige el default del catálogo (ADR-01).
- **Why:** `tax_inclusive_map` se envía (`:253`) pero `createMany:1031` solo usa ids: el bug visible del usuario.
- **Output:** `tax_inclusive_map?: Record<number,boolean>` en Create/Update DTO con validadores; create/update/replace de asignaciones lo persisten; GET lo expone por asignación; `PROD_TAXMAP_001` (400) para mapa inválido.
- **Contracts touched:** FB-01, FB-02, DB-02, ERR-01.
- **Data impact:** Escrituras en `product_tax_assignments.is_inclusive` por producto editado; sin mapa explícito se hereda catálogo (mismo total que hoy).
- **Blast radius:** Endpoints de productos; otros dominios solo leen (A.3/A.4). Sin mapa en la petición, byte-idéntico a hoy.
- **Rollback:** Revert del commit; la columna queda sin usar hasta re-deploy.
- **Verification:**
  - `npx tsc --noEmit -p apps/backend/tsconfig.json`
  - `curl POST /store/products` con mapa mixto → `GET` devuelve flags por asignación
  - `curl` con mapa inválido → 400 `PROD_TAXMAP_001` (evidencia en `evidence/A.2-err01.json`)
  - specs `products.service`/`products-bulk-edit` en verde
- **Acceptance checklist:**
  - [ ] Mapa válido persiste por categoría en create, update y replace
  - [ ] Sin mapa: se hereda `tax_categories.is_inclusive` al asignar
  - [ ] ERR-01 emite 400 con código registrado y el form no se pierde
  - [ ] GET expone `is_inclusive` por asignación para FB-02
  - [ ] F-006 — Update sin mapa re-hereda catalogo y borra decisiones (major)
  - [ ] F-008 — product-create-page tercer escritor sin contrato (major)
  - [ ] F-009 — Bulk sin scope tienda; ADD revierte flags en silencio (major)
  - [ ] F-017 — DTO bulk por modo: ADD preserva, REPLACE exige mapa, REMOVE ignora (major)
  - [ ] F-018 — Mapa: coercion JSON, upsert, includes del GET (minor)
  - [ ] F-025 — Record<number,boolean> no sobrevive JSON sin normalizar (major)
  - [ ] F-026 — Semantica parcial del mapa: 4 casos sin definir (major)
  - [ ] F-027 — Mapa muere en destructuring; update no puede heredar (blocker)
  - [ ] F-029 — Preview difunde nombres; cambio solo-flag invisible (major)
  - [ ] F-030 — Deploy inverso rompe: whitelist 400 y GET viejo sin flag (major)
  - [ ] F-031 — GET lista/bulk sin flag aunque detalle lo exponga (major)
  - [ ] F-034 — Matriz create/update/parcial/replace del mapa (major)
  - [ ] F-035 — Claves del mapa: tenant, pertenencia y enteras o 400 (major)
- **Status:** done

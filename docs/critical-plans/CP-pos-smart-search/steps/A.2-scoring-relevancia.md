---
id: A.2
title: "Scoring de relevancia producto + specs"
phase: A
status: done
owner: none
updated: 2026-09-17
contracts: []
adrs: [ADR-01, ADR-03]
skills: [vendix-backend, vendix-naming-conventions, vendix-product-variants]
---
# A.2 — Scoring de relevancia producto + specs

- **Skills:** vendix-backend, vendix-naming-conventions, vendix-product-variants
- **Resources:** none
- **Business decision:** El ranking premia identidad sobre texto y nombre sobre descripción; contrato genérico en `common/` (sin importar producto) + pesos de producto en el dominio; motor siempre provider-free (nunca DI). Cero IA: pesos fijos auditables.
- **Why:** Tercero porque B.2/D.1/D.2/D.3 lo consumen; antes de tocar wheres hay que tener scoring + orquestación probados en aislamiento.
- **Output:** `common/utils/search-score.util.ts` (contrato genérico scoreTokens sobre field-extractors + SEARCH_WEIGHTS compartido B.2/C.3 + rankedIdsPage(where,page,limit,scoreFn)) + `products/services/product-search-relevance.util.ts` (extractors producto + re-score variantes top-K) + specs.
- **Contracts touched:** none — funciones puras sin I/O ni contratos
- **Data impact:** none — código puro, sin lecturas ni escrituras
- **Blast radius:** Nulo hasta B.2; pesos mal calibrados enterrarían el producto obvio (detectado por casos del checklist).
- **Rollback:** `git revert` del commit; ningún consumidor existe aún.
- **Verification:**
  - `npm run buildcheck:test -- src/domains/store/products/services/product-search-relevance.util.spec.ts`
- **Acceptance checklist:**
  - [x] 'café negro granizado con hielo y chocolate' rankea 1º para ['cafe','chocolate']
  - [x] sku exacto supera a nombre parcial; barcode exacto suma bonus +30
  - [x] Orden estable: score→coverage→featured→created_at→id (sin flips entre páginas)
  - [x] variants.name suma sin filtrar por stock (vendible ≠ disponible)
  - [x] SEARCH_WEIGHTS + fixture 4 queries compartidos B.2/C.3 (mismo orden ambos flags)
  - [x] rankedIdsPage reusable: D.1/D.2/D.3 cablean solo delegates (cero duplicación)
  - [x] F-014 — Scoring en products cruza frontera ecommerce (major)
  - [x] F-019 — Scoring duplicado B.2 vs C.3 sin contrato pesos (major)
  - [x] F-072 — Orquestación rank privada; hermanos la triplican (minor)
  - [x] F-073 — Motor en products pre-ordena ciclo DI futuro (minor)
- **Status:** done

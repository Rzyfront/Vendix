---
id: C.3
title: "searchIdsRanked raw scopeado + ranking SQL"
phase: C
status: done
owner: none
updated: 2026-09-17
contracts: [FB-01, FB-04, FB-05, FB-14, DB-01, DB-11, DB-14, DB-16, DB-17, ERR-01, ERR-17, ERR-21]
adrs: [ADR-01, ADR-04, ADR-08]
skills: [vendix-backend, vendix-backend-api, vendix-prisma-scopes, vendix-multi-tenant-context]
---
# C.3 — searchIdsRanked raw scopeado + ranking SQL

- **Skills:** vendix-backend, vendix-backend-api, vendix-prisma-scopes, vendix-multi-tenant-context
- **Resources:** `curl -H 'Authorization: Bearer $T' "$API/store/products?search=cafe%20chocolate&pos_optimized=true&state=active" | jq '.data[0].name'`
- **Business decision:** Fail-closed: store_id entero+ desde ALS directo o Forbidden (jamás fallback estático/DTO); `$queryRawUnsafe` solo con placeholders $1..$n + ESCAPE; expresión canónica ≡ GIN; full filter-set + COUNT twin; rank SEARCH_WEIGHTS; timeout+slow-log; errores→genérico/fallback A.
- **Why:** Noveno porque consume C.1/C.2; reemplaza rama B.2 tras TRIGRAM∧capability (A.0), con B.2 como fallback vivo + degradado señalizado.
- **Output:** searchIdsRanked(storeId,filters,tokens,limit) + predicate-builder compartido rank+COUNT + integración findAll/findIds + specs (AND, tildes, ranking, scope×2, filtros, inyección, LIKE-literal, description) + EXPLAIN gate automatizado + probe GIN.
- **Contracts touched:** FB-01, FB-04, FB-05, FB-14, DB-01, DB-11, DB-14, DB-16, DB-17, ERR-01, ERR-17, ERR-21
- **Data impact:** none — lectura indexada por tenant + COUNT twin; statement_timeout acota patológicas.
- **Blast radius:** Scope roto = fuga cross-tenant (fail-closed + 2 negativos lo cierran); filtros bypassados = top-N erróneo (paridad matricial); error driver expuesto (contrato genérico).
- **Rollback:** TRIGRAM off (A.0) vuelve a B.2 en siguiente request (≤TTL); código revertible sin tocar DB.
- **Verification:**
  - `EXPLAIN (ANALYZE, BUFFERS) SELECT ... ; curl -s -H "Authorization: Bearer $T" "$API/store/products?search=cafe" | jq '.data[0].name'`
- **Acceptance checklist:**
  - [x] 'cafe' sin tilde halla 'café...' y rankea 1º (recall total) — vivo: 26/26 rank-1 `...23 E1PAG`
  - [x] Negativos: tienda B≁A + contexto-undefined lanza (cero filas) — specs ×2 + vivo playstation→0 + 26/26 en 1 tienda
  - [x] EXPLAIN automatizado aserta Bitmap Index Scan GIN, p95 <80ms staging — scripts/pos-search-explain-gate.sh VERDE; p95 dev 35ms (formal staging)
  - [x] Fixture 4 queries rankea 1º bajo L2 y TRIGRAM (mismo orden) — 4/4 idénticos + fixture F-081 en spec
  - [x] Filtros state/brand/category paridad + COUNT twin byte-idéntico — spec paridad + twin + vivo brand + diff /ids vacío
  - [x] Tokens `' OR '1'='1`, `%`, `_` literales; searchIdsRanked sin `${}` (grep) — specs adversariales + ESCAPE + casts + conductual servicio
  - [x] F-004 — store_id raw hereda contexto spoofeable sin fail-closed (blocker) — ALS-directo + match caller, Forbidden propaga
  - [x] F-026 — Expresión índice sin fijar; GIN sin uso silencioso (major) — TRIGRAM_CANONICAL_FN + spec + gate catálogo
  - [x] F-027 — Description fuera de oleada 1: Fase B regresa recall (major) — rama OR no-indexada acotada por store (documentada, recall completo)
  - [x] F-028 — Raw bypassa filtros state/category/brand (major) — full filter-set espejo + specs + vivo
  - [x] F-029 — Sin COUNT twin: total diverge del conjunto rankeado (major) — twin byte-idéntico + sharedParams
  - [x] F-030 — $queryRaw nombrado pero solo existe $queryRawUnsafe (major) — $queryRawUnsafe + placeholders + casts, cero interpolación
  - [x] F-070 — Slow-query invisible en path trigram (major) — SET LOCAL 2000ms + slow-log 250ms + histograma
  - [x] F-080 — Metacaracteres LIKE sin escapar (%, _) (minor) — escapeLike + ESCAPE + specs
  - [x] F-081 — Paridad tokenizer-JS vs SQL sin fijar (minor) — fixture 4 queries pineado + vivo
  - [x] F-085 — Errores raw/P2010 pueden ecoar schema y tenant (minor) — spec cero eco + meta genérica viva
  - [x] F-101 — Verificación índice solo-archivo sin re-check runtime (minor) — probe A.0 + gate catálogo/escala
  - [x] F-090 — Sin admission control en path search (minor) — timeout + tokens≤8 + limit + scan_cap + ids cap
- **Status:** done
- **Evidencia:** evidence/C.3-ranked-ids-trigram.md (vivos, gate, hallazgos P2010/hydrate/watch, divergencia símbolos documentada)

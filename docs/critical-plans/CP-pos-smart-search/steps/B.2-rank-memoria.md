---
id: B.2
title: "findAll rama rank-memoria con scan-cap"
phase: B
status: done
owner: none
updated: 2026-09-17
contracts: [FB-01, FB-04, FB-05, FB-06, FB-07, FB-14, DB-01, DB-03, DB-04, DB-07, DB-17, ERR-01, ERR-17, ERR-18]
adrs: [ADR-03, ADR-08]
skills: [vendix-backend, vendix-backend-api, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-inventory-stock]
---
# B.2 — findAll rama rank-memoria con scan-cap

- **Skills:** vendix-backend, vendix-backend-api, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-inventory-stock
- **Resources:** `curl -H 'Authorization: Bearer $T' "$API/store/products?search=cafe&pos_optimized=true&state=active&page=2" | jq '[.data[].id]'`
- **Business decision:** Rank para TODO caller con `search && !barcode` (F-001); score primario, featured boost, best_selling suprimido con search; two-tier (producto→top-K variantes); skip-count si ≤cap; caché Redis id-list 30-60s; degrade con warn+counter+meta.search; flag Fase A gateado por tamaño catálogo.
- **Why:** Quinto porque ordena lo que B.1 recupera; antes de B.3 (specs) y de Fase C que lo reemplaza tras TRIGRAM+capability.
- **Output:** Rama `search&&!barcode` en findAll vía rankedIdsPage (A.2): light producto-only → score → caché → slice clampado a @Max → hydrate top-K+variantes → re-score → re-sort; count omitido si ≤cap; línea estructurada request_id + warn degrade + counter; paridad shapes + cocina; settings memo + signUrl audit.
- **Contracts touched:** FB-01, FB-04, FB-05, FB-06, FB-07, FB-14, DB-01, DB-03, DB-04, DB-07, DB-17, ERR-01, ERR-17, ERR-18
- **Data impact:** none — lectura + caché Redis TTL (invalidación por expiración); ≤2 round-trips/keystroke caso común
- **Blast radius:** Orden con search en todos los herederos; pos_optimized conserva ACTIVE + stock displayable; findIds mismo conjunto; sobre cap → orden legacy + chip UI (ERR-17).
- **Rollback:** Flag L2 off (A.0) restaura orderBy en siguiente request (≤TTL); si no, `git revert`.
- **Verification:**
  - `curl -s -H "Authorization: Bearer $T" "$API/store/products?search=cafe&pos_optimized=true&state=active" | jq '.data[0].name'`
- **Acceptance checklist:**
  - [x] Mejor match primero con search; total == conjunto rankeado pre-slice
  - [x] Página 2 no repite ids de página 1 (orden determinista)
  - [x] Sobre scan-cap: degrada a orderBy sin vaciar grilla (fail-open)
  - [x] findIds devuelve mismo conjunto que findAll con filtros (DB-17)
  - [x] Degrade emite warn + counter + meta.search.rank_mode (auditable)
  - [x] search+best_selling: rank textual gana; featured-débil vs exacto pineado
  - [x] Paridad shapes flag-on/off + cocina sin dinero; página-2-caché sin scan
  - [x] F-001 — Rank gate pos_optimized contradice hereda-ranking (blocker)
  - [x] F-005 — Fase A: 3 queries/2 seq-scans por keystroke (blocker)
  - [x] F-012 — Fail-open scan-cap silencioso (log+counter+meta) (blocker)
  - [x] F-017 — Light query verbatim sin texto para scorizar (major)
  - [x] F-018 — Rama rank colisiona con best_selling_first (major)
  - [x] F-022 — Precedencia rank vs featured_first sin especificar (major)
  - [x] F-034 — Fail-open no cubre throws de light/hydrate (major)
  - [x] F-044 — Rank query trae variantes anchas: wire/memory por keystroke (major)
  - [x] F-045 — limit/search sin cota → hydrate pesado/OOM (major)
  - [x] F-046 — Cada página re-scanea y re-ordena sin caché (major)
  - [x] F-068 — Sin correlation id ni timing por etapa (major)
  - [x] F-076 — Hydrate B.2 debe preservar 2 shapes + promo + cocina (minor)
  - [x] F-083 — Delete concurrente light→hydrate = página corta (minor)
  - [x] F-089 — Extras fijos por keystroke comen p95 (minor)
- **Status:** done

---
id: D.3
title: "Catálogo público tokenizado + safeguards"
phase: D
status: done
owner: none
updated: 2026-09-17
contracts: [FB-12, DB-01, ERR-01, ERR-04, ERR-16, ERR-22, ERR-23]
adrs: [ADR-02, ADR-05, ADR-09]
skills: [vendix-backend, vendix-backend-api, vendix-validation, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-redis-quota]
---
# D.3 — Catálogo público tokenizado + safeguards

- **Skills:** vendix-backend, vendix-backend-api, vendix-validation, vendix-prisma-scopes, vendix-multi-tenant-context
- **Resources:** `curl "$API/ecommerce/catalog?search=cafe&limit=5" -H "x-store-id: 1" | jq '.data|length'`
- **Business decision:** Wrapper tokenizePublic(4) requerido; proyección pública allowlist (costos/tax/stock fuera); x-store-id validado (missing→404/400 en service); min-length + throttle IP + caché; search overridea sort_by; clamp 200 client-side.
- **Why:** Décimo-paralelo: pública sin auth, mayor riesgo Fase D; safeguards + gates adversariales antes de merge.
- **Output:** catalog.service OR-tokenizado + ranking + proyección allowlist + throttle/caché/min-length + specs + evidencias p95/brute-force + RATE_LIMIT_001 (existente o registrado).
- **Contracts touched:** FB-12, DB-01, ERR-01, ERR-04, ERR-16, ERR-22, ERR-23
- **Data impact:** none — lectura + caché Redis corta + contadores throttle TTL.
- **Blast radius:** Abuso/bot degrada pool compartido (throttle+caché lo cierran); shape público fijado por allowlist (cero filtración admin).
- **Rollback:** Flag heredero off restaura OR legacy en siguiente request (≤TTL); `git revert`.
- **Verification:**
  - `curl -s "$API/ecommerce/catalog?search=cafe&limit=5" -H "x-store-id: 1" | jq '.data|length'`
- **Acceptance checklist:**
  - [x] Multi-palabra rankeada; tope 4 (wrapper) + meta applied-tokens
  - [x] x-store-id missing/abc/0/-1/array → 400/401 con specs; cero fuga
  - [x] p95 staging <200ms + brute-force 60s: 429s, pool sano (evidence/)
  - [x] Autocomplete (?search=) navega y muestra matches rankeados
  - [x] Spec diff shape público-vs-admin: costos/tax_map/stock fuera
  - [x] F-024 — MaxLength-400 contradice ERR-04 sin manejo frontend (major)
  - [x] F-038 — Tenant público atacante-controlado sin proyección allowlist (major)
  - [x] F-042 — x-store-id fuera de superficie validada (major)
  - [x] F-047 — Catálogo público sin throttle/caché/min-length (major)
  - [x] F-077 — Truncado 4-tokens silencioso sin señal (minor)
  - [x] F-087 — Cap 4-vs-6 en call-site, no en frontera validada (minor)
  - [x] F-088 — sort_by sin RELEVANCE; forbidNonWhitelisted bloquea ops params (minor)
- **Status:** done
- **Evidence:** evidence/D.3-catalogo-publico.md (specs 24 + matriz viva 8/8 + p95 4ms + flood 3336×429 + pool sano).

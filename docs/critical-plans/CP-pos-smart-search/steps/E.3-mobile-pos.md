---
id: E.3
title: "Mobile POS search parity"
phase: E
status: pending
owner: none
updated: 2026-09-17
contracts: [FB-14, ERR-01, ERR-02]
adrs: [ADR-05]
skills: [mobile-dev]
---
# E.3 — Mobile POS search parity

- **Skills:** mobile-dev
- **Resources:** none
- **Business decision:** El POS móvil alcanza los mismos resultados que web (load-more + contador + respeto a rank) y deja de enviar keys prohibidas; paridad verificada, no asumida.
- **Why:** Tras E.2 porque consume el ranking backend ya gateado; antes de E.4 porque el rollout full exige paridad móvil cerrada.
- **Output:** `ProductService.list` strip de keys no-whitelisted + comentarios corregidos; lista POS móvil con load-more + contador + sin re-sort local.
- **Contracts touched:** FB-14, ERR-01, ERR-02
- **Data impact:** none — solo lectura paginada.
- **Blast radius:** Solo `apps/mobile`; strip mal hecho rompería filtros drawer (fallback local existente lo cubre).
- **Rollback:** `git revert` del cambio móvil; backend intacto.
- **Verification:**
  - `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $T" "$API/store/products?search=cafe&state=active" | grep 200`
- **Acceptance checklist:**
  - [ ] Filtro precio activo → HTTP 200 (keys strip antes de enviar)
  - [ ] Load-more + contador; cero re-sort local del rank backend
  - [ ] Comentarios whitelist:false corregidos (3 sitios)
  - [ ] Rank-25 alcanzable en móvil igual que web
  - [ ] F-025 — FB-14 field-of-more móvil: min_price→400 (major)
  - [ ] F-059 — Mobile POS sin paso UI (major)
- **Status:** pending

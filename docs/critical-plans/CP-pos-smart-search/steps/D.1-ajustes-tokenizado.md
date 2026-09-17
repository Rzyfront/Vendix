---
id: D.1
title: "Ajustes: search tokenizado"
phase: D
status: pending
owner: none
updated: 2026-09-17
contracts: [FB-10, DB-01, ERR-01]
adrs: [ADR-02, ADR-05]
skills: [vendix-backend, vendix-backend-api, vendix-validation, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-inventory-stock]
---
# D.1 — Ajustes: search tokenizado

- **Skills:** vendix-backend, vendix-backend-api, vendix-validation, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-inventory-stock
- **Resources:** `curl -H 'Authorization: Bearer $T' "$API/store/inventory/adjustments/search-products?search=cafe&location_id=1" | jq '.data|length'`
- **Business decision:** Mismo helper L1+L2, conservando filtro location_id y product_variant_id por fila; sin rescate difuso agresivo (conteo físico no admite parecido).
- **Why:** Décimo porque reutiliza A.1/A.2 ya probados; archivos disjuntos de D.2/D.3 (distinto service) → paralelizable; solo lee el helper compartido (P9-F10).
- **Output:** searchAdjustableProducts vía buildTokenAndFieldOr (nestPath `products:`) + rankedIdsPage + specs; DTO huérfano documentado, jamás importado (F-074).
- **Contracts touched:** FB-10, DB-01, ERR-01
- **Data impact:** none — solo lectura.
- **Blast radius:** Scanner-modal de reconteo; resultado erróneo = conteo contra producto equivocado (mitigado: ranking no filtra, solo ordena).
- **Rollback:** Flag off restaura contains legacy; `git revert`.
- **Verification:**
  - `curl -s -H "Authorization: Bearer $T" "$API/store/inventory/adjustments/search-products?search=cafe&location_id=1" | jq '.data|length'`
- **Acceptance checklist:**
  - [ ] 'cafe tubo' halla producto multi-palabra con location_id intacto
  - [ ] product_variant_id por fila se conserva tras el cambio
  - [ ] Sin search: comportamiento idéntico a legacy
  - [ ] Specs del service verdes con casos tokenizados
- **Status:** pending

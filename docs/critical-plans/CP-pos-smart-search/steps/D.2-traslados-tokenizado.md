---
id: D.2
title: "Traslados: search tokenizado"
phase: D
status: pending
owner: none
updated: 2026-09-17
contracts: [FB-11, DB-01, ERR-01]
adrs: [ADR-02, ADR-05]
skills: [vendix-backend, vendix-backend-api, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-inventory-stock]
---
# D.2 — Traslados: search tokenizado

- **Skills:** vendix-backend, vendix-backend-api, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-inventory-stock
- **Resources:** `curl -H 'Authorization: Bearer $T' "$API/store/stock-transfers/search-products?search=cafe&from_location_id=1&to_location_id=2" | jq '.data|length'`
- **Business decision:** Mismo helper L1+L2 conservando some stock@origen y shape sin ResponseService (no cambiar envelope aquí); sin rescate difuso.
- **Why:** Décimo-paralelo a D.1: misma mecánica, archivos disjuntos (distinto service) → paralelizable; independiente de C (L1+L2; trigram solo si se migra su query después).
- **Output:** searchTransferableProducts vía buildTokenAndFieldOr + rankedIdsPage + specs; envelope intacto; DTO huérfano jamás importado.
- **Contracts touched:** FB-11, DB-01, ERR-01
- **Data impact:** none — solo lectura.
- **Blast radius:** Picker de traslados; shape de respuesta no cambia (cero riesgo de contrato de forma).
- **Rollback:** Flag off restaura contains legacy; `git revert`.
- **Verification:**
  - `curl -s -H "Authorization: Bearer $T" "$API/store/stock-transfers/search-products?search=cafe&from_location_id=1&to_location_id=2" | jq '.data|length'`
- **Acceptance checklist:**
  - [ ] Multi-palabra halla producto conservando stock@origen/destino
  - [ ] Shape {success,data[]} idéntico (sin ResponseService, como hoy)
  - [ ] Sin search: comportamiento idéntico a legacy
  - [ ] Specs del service verdes con casos tokenizados
- **Status:** pending

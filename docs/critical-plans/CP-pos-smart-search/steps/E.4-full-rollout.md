---
id: E.4
title: "Full rollout + métricas + audit"
phase: E
status: pending
owner: none
updated: 2026-09-17
contracts: [FB-01, FB-04, FB-05, FB-10, FB-11, FB-12, FB-14, FB-15, ERR-01, ERR-05, ERR-10, ERR-15, ERR-16, ERR-17, ERR-18, ERR-19, ERR-20, ERR-21, ERR-22, ERR-23]
adrs: [ADR-01, ADR-05, ADR-08]
skills: [vendix-backend, vendix-frontend]
---
# E.4 — Full rollout + métricas + audit

- **Skills:** vendix-backend, vendix-frontend
- **Resources:** `curl -H 'Authorization: Bearer $T' "$API/store/products?search=cafe%20chocolate&pos_optimized=true" | jq '.meta.search'`
- **Business decision:** Rollout full solo con herederos E2E verdes + TRIGRAM gateado + métricas (latencia, L1-vacío, CTR posición, degrade-ratio) + audit de flags; orden L1→L2→TRIGRAM→herederos.
- **Why:** Último porque cierra el plan: verifica integración total, instrumenta la calibración futura y deja trail de cada toggle.
- **Output:** Evidencia E2E full en evidence/, dashboards (p95, CTR top-1/top-3, degrade-ratio), matriz flags v2, interleaving Vexi×search pineado.
- **Contracts touched:** FB-01, FB-04, FB-05, FB-10, FB-11, FB-12, FB-14, FB-15, ERR-01, ERR-05, ERR-10, ERR-15, ERR-16, ERR-17, ERR-18, ERR-19, ERR-20, ERR-21, ERR-22, ERR-23
- **Data impact:** none — solo lectura, métricas y toggles auditados.
- **Blast radius:** Activación global sin métricas = calibración ciega; kill-switch primero ante incidente.
- **Rollback:** Kill-switch global ya; luego flags off por tienda en inverso; evidencia conservada.
- **Verification:**
  - `curl -s -H "Authorization: Bearer $T" "$API/store/products?search=cafe" | jq '.meta.search.rank_mode'`
- **Acceptance checklist:**
  - [ ] curl FB-01/FB-10/FB-11/FB-12/FB-14 rankeados + meta.search presente
  - [ ] CTR top-1/top-3 registrado 1 semana antes de recalibrar pesos
  - [ ] Interleaving Vexi-refresh × search pendiente sin flash vacío
  - [ ] Todo toggle con fila audit_logs verificable
  - [ ] F-069 — Sin señal CTR/posición; pesos no recalibrables (major)
  - [ ] F-094 — Refresh Vexi flashea grilla mid-search sin regla (minor)
- **Status:** pending

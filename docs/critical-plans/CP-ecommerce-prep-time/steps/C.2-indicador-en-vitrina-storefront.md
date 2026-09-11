---
id: C.2
title: "Indicador en vitrina storefront"
phase: C
status: in-progress
owner: agent
updated: 2026-09-11
contracts: [FB-03, FB-04, FB-05]
adrs: [ADR-01, ADR-02]
skills: [vendix-frontend, vendix-zoneless-signals, vendix-restaurant-ops]
---
# C.2 — Indicador en vitrina storefront

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-restaurant-ops
- **Resources:** none
- **Business decision:** Renderiza `~X min` con `app-badge`/`app-icon` solo si el flag es `true` y los minutos son mayores a cero; sin dato no muestra nada.
- **Why:** Va despues de B.1 porque consume su contrato; corre en paralelo con C.1 porque no comparten archivos.
- **Output:** Indicador en tarjeta y ficha de `storefront.component.ts`, gateado por el flag de `config/public`.
- **Contracts touched:** FB-03, FB-04, FB-05
- **Data impact:** Ninguno; solo lectura del contrato del catalogo.
- **Blast radius:** Si el gate falla abierto, tiendas que nunca lo pidieron muestran el indicador; si falla la lectura, rompe la card.
- **Rollback:** `git revert` del commit; sin el componente la vitrina es la historica.
- **Verification:**
  - `Playwright MCP en vhost real: flag on muestra ~X min; flag off o 0/null no renderiza`
- **Acceptance checklist:**
  - [x] Indicador en tarjeta y ficha gateado por flag y minutos > 0 (commit 553c37517)
  - [x] Flag off / 0 / null / ausente no renderiza (default false, revision estatica)
  - [x] Card conserva precio/stock/promo: diff solo suma input y bloque @if
  - [ ] Render vivo en vhost (transfiere a entorno sano; evidencia/d1-sweep.txt)
- **Status:** in-progress · agent · 2026-09-11

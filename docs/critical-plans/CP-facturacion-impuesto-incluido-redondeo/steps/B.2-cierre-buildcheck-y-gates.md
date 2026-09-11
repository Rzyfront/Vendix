---
id: B.2
title: "Cierre buildcheck y gates"
phase: B
status: pending
owner: none
updated: 2026-09-11
contracts: []
adrs: [ADR-03]
skills: [vendix-frontend, vendix-zoneless-signals, vendix-currency-formatting]
---
# B.2 — Cierre buildcheck y gates

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-currency-formatting
- **Resources:** `bash scripts/buildcheck.sh` (workdir repo); `git status --short --branch` (verificación limpia, sin cambio de rama)
- **Business decision:** Ningún display muestra dos totales distintos para el mismo snapshot; carta, tirilla y letras dicen lo mismo porque formatean el mismo total.
- **Why:** Va último porque solo tiene sentido con el snapshot correcto: confirma paridad visual carta/tirilla/letras y que el árbol queda commiteado por scopes en la rama actual.
- **Output:** buildcheck verde; factura manual $3.000 INC 8% con TOTAL $3.000, letras TRES MIL PESOS M/CTE y tirilla $3.000,00; memoria Engram guardada; PR con review ≥ 80%.
- **Contracts touched:** none — cierre y verificación, sin delta de contrato.
- **Data impact:** none — sin mutación de datos.
- **Blast radius:** Visual/puerta de merge: si carta y tirilla difieren, se vuelve a A.3, no se maquilla el display.
- **Rollback:** No aplica (verificación); el PR no se fusiona hasta los gates de git-workflow R5–R8.
- **Verification:**
  - `bash scripts/buildcheck.sh` exit 0 (workdir repo)
  - `git status --short --branch` muestra la rama actual sin switches
- **Acceptance checklist:**
  - [ ] buildcheck verde sin procesos huérfanos
  - [ ] Carta, tirilla y letras coinciden en la prueba
  - [ ] Memoria Engram What/Why/Where/Learned guardada
  - [ ] PR con pr-code-review ≥ 80% y rama al día
  - [ ] F-049 — Papel con decimales variables, pantallas fijos (minor)
  - [ ] F-059 — Letras inverificables antes de emitir (minor)
- **Status:** in_progress · orquestador · 2026-09-11 · buildcheck:test sobre los 8 patrones tocados: 9 suites / 296 tests en verde; 2 suites (`checkout-inclusive-line.parity`, existente `checkout.service.spec`) no compilan por `TS2307 uuid` en `tables.service.ts` — preexistente y ambiental (`uuid` ausente de package.json y node_modules, archivo intacto en este plan, probado con el spec committed). Fix de tipos propio (`normalizeTypedRates` → `TaxRateForResolution`, cast `InclusiveRateBasis` estilo checkout) verificado con `storefront-price-residual.parity` en verde. Full `scripts/buildcheck.sh` y verificación visual carta/tirilla pendientes.

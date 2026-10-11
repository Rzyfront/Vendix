---
id: C.1
title: "verificar flujos contratos y accesibilidad"
phase: C
status: pending
owner: orquestador
updated: 2026-10-06
contracts: [FB-01, FB-02, FB-03, FB-04, FB-05, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07, ERR-08, ERR-09, ERR-10, ERR-11, ERR-12, ERR-13]
adrs: [ADR-01, ADR-02, ADR-03]
skills: [how-to-test, buildcheck-dev, vendix-ui-ux, vendix-restaurant-ops, vendix-permissions, sopus]
---
# C.1 — verificar flujos contratos y accesibilidad

- **Skills:** how-to-test, buildcheck-dev, vendix-ui-ux, vendix-restaurant-ops, vendix-permissions, sopus
- **Resources:** `bash scripts/buildcheck.sh --watch`; `curl` dev; Playwright MCP en `https://vendix.com/admin/orders/sales`; `bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-qui-919-fuego-kds-ordenes`
- **Business decision:** No se entrega si el mínimo KDS, la integridad del fire o la recuperación SSE no están demostrados.
- **Why:** Las pruebas unitarias no muestran la interacción real entre REST, fire, SSE y tarjetas.
- **Output:** `evidence/c1-runtime.md` con comandos, respuestas, capturas, conteos y veredicto.
- **Contracts touched:** FB-01, FB-02, FB-03, FB-04, FB-05, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07, ERR-08, ERR-09, ERR-10, ERR-11, ERR-12, ERR-13
- **Data impact:** Solo fixture dev: un fire puede consumir stock y crear asiento.
- **Blast radius:** Un verde falso o POST duplicado puede afectar operación y contabilidad.
- **Rollback:** Bloquear merge; revertir paso responsable y revalidar.
- **Verification:**
  - `bash scripts/buildcheck.sh --watch` y `curl -fsS http://localhost:3000/api/health`
  - Playwright MCP happy/sad/brute en dev; capturar POST, SSE, tooltip, roles y tamaños.
  - `bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-qui-919-fuego-kds-ordenes`
- **Acceptance checklist:**
  - [ ] Happy: un fire, ticket y stock/COGS correctos; icono cambia sin F5.
  - [ ] Sad: envío parcial, stock insuficiente, KDS sin default, cancelado y offline sin éxito falso.
  - [ ] Brute: repetir POST, ids ajenos, tienda ajena y rol sin create no mutan datos.
  - [ ] Móvil 375/767 y desktop 768/1024 mantienen acción/indicador y lectura accesible.
  - [ ] Cerrar solo tras 13 perspectivas y dos rondas limpias de ejecución.
  - [ ] F-005 — Runner frontend incompatible (major)
- **Status:** pending · orquestador · 2026-10-06

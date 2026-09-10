---
id: C.1
title: "verificacion e2e y convergencia"
phase: C
status: in-progress
owner: Rafael Eduardo Martinez Frontado
updated: 2026-09-10
contracts: [FB-01, FB-02, FB-03]
adrs: [ADR-01, ADR-02]
skills: [how-to-test, vendix-error-handling, vendix-permissions, buildcheck-dev]
---
# C.1 — verificacion e2e y convergencia

- **Skills:** how-to-test, vendix-error-handling, vendix-permissions, buildcheck-dev
- **Resources:** Playwright MCP, buildcheck-dev, log/convergence.md, pr-code-review gate 80 por ciento
- **Business decision:** No se mergea sin E2E cross-tienda en verde y dos rondas de convergencia limpias.
- **Why:** El riesgo critico (fuga entre tiendas, duplicados, spam) solo se ve con dos sesiones vivas y kill de stream.
- **Output:** Evidencia E2E en evidence/ + matriz de 13 perspectivas con 2 rondas limpias + ledger regenerado.
- **Contracts touched:** FB-01, FB-02, FB-03
- **Data impact:** none — seeds de prueba en dev; ningun dato de prod se toca ni se migra.
- **Blast radius:** Falso verde: un E2E que no mata el stream declara resiliente lo fragil.
- **Rollback:** Bloquear merge y revert del PR; hotfix de 1 linea refiltra created si algo fuga en prod.
- **Verification:**
  - npx playwright test e2e/orders-sales-sse.spec.ts --reporter=line
  - .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-orders-sales-sse-realtime
- **Acceptance checklist:**
  - [x] Unit frontend 13/13 SUCCESS (SSE created+status) → evidence/c1-karma-sse.log
  - [ ] E2E dos sesiones + cross-tienda + kill/reconnect: dev apagado, pendiente
  - [x] cp-lint exit 0 + review PR #780 scope SSE 95/100 APPROVE (fiscal: del sibling)
  - [ ] Dos rondas de convergencia limpias con entry points variados
- **Status:** in-progress · Rafael Eduardo Martinez Frontado · 2026-09-10 · review OK; falta E2E con dev arriba

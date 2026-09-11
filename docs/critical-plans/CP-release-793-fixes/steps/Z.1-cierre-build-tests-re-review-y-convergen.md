---
id: Z.1
title: "Cierre: build, tests, re-review y convergencia"
phase: Z
status: pending
owner: none
updated: 2026-09-11
contracts: [FB-01, FB-02, FB-03, FB-04, FB-05, FB-06, DB-01, DB-02, DB-03, DB-04, DB-05, ERR-01, ERR-02, ERR-03, ERR-04]
adrs: []
skills: [buildcheck-dev, pr-code-review, how-to-test, git-workflow]
---
# Z.1 — Cierre: build, tests, re-review y convergencia

- **Skills:** buildcheck-dev, pr-code-review, how-to-test, git-workflow
- **Resources:** Bundle completo, PR #793, CI del PR, skill pr-code-review (gate 80%%), trece perspectivas
- **Business decision:** Nada se declara done sin: registry verificado fila por fila, `cp-lint.sh` exit 0, `pr-code-review` >= 80%% y dos rondas de convergencia limpias (piso 2, techo 6).
- **Why:** Es el gate que deja el release limpio, seguro y funcional. Incluye la auditoria adversarial que el skill exige antes de cerrar.
- **Output:** Ledger al dia, `log/convergence.md` con rondas, re-review >= 80%% y hub en done tras aprobacion de merge.
- **Contracts touched:** FB-01, FB-02, FB-03, FB-04, FB-05, FB-06, DB-01, DB-02, DB-03, DB-04, DB-05, ERR-01, ERR-02, ERR-03, ERR-04 — barrido fila por fila.
- **Data impact:** none — verificacion, sin cambios.
- **Blast radius:** Ninguno (no se modifica codigo en este step).
- **Rollback:** N/A — no hay cambios.
- **Verification:**
  - `skills/how-to-critical-plan/assets/cp-lint.sh <bundle>` exit 0
  - `cp-ledger.sh` regenerado y todas las filas del registry en [x] con evidencia
  - Re-review del PR con pr-code-review >= 80%% (requisito git-workflow R8)
  - Trece perspectivas en rondas de convergencia hasta dos limpias seguidas
- **Acceptance checklist:**
  - [ ] Registry completo verificado y lint en verde con evidencia
  - [ ] Re-review >= 80%% registrado y convergencia cerrada en el log
  - [ ] Hub en done y PR release listo para merge a main
- **Status:** pending

---
id: E.1
title: "E2E y convergencia de cierre"
phase: E
status: in-progress
owner: rzy
updated: 2026-09-11
contracts: [FB-01, FB-02, FB-04, DB-01, DB-02, ERR-01, ERR-02, ERR-03, ERR-04]
adrs: []
skills: [vendix-frontend, vendix-backend-api, vendix-error-handling, pr-code-review, parallel]
---
# E.1 — E2E y convergencia de cierre

- **Skills:** vendix-frontend, vendix-backend-api, vendix-error-handling, pr-code-review, parallel
- **Resources:** `bash skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-pos-customer-stale`
- **Business decision:** Nada se declara listo sin dos rondas limpias, ledger regenerado y review de 80%.
- **Why:** Cierra el plan: integra C y D, corre las trece perspectivas y deja el bundle retomable en frío.
- **Output:** `log/convergence.md` con dos rondas limpias y hub en `status: done` tras aprobación.
- **Contracts touched:** FB-01, FB-02, FB-04, DB-01, DB-02, ERR-01, ERR-02, ERR-03, ERR-04
- **Data impact:** none — verificación y auditoría, sin mutación.
- **Blast radius:** Cerrar sin convergencia deja un blocker fiscal latente en prod.
- **Rollback:** Reabrir findings y rondas; no hay cambio irreversible en este paso.
- **Verification:**
  - `bash skills/how-to-critical-plan/assets/cp-ledger.sh docs/critical-plans/CP-pos-customer-stale`
- **Acceptance checklist:**
  - [x] Trece perspectivas corridas con hallazgos fileados (R1-R4)
  - [x] Dos rondas consecutivas sin blocker ni major (R3 minor-only, R4 limpia)
  - [ ] Todos los registry rows en [x] con evidencia (bloqueado: sin backend vivo)
  - [x] `cp-lint.sh` exit 0 y ledger regenerado
  - [ ] `pr-code-review` >= 80% antes del merge (gate pre-PR)
- **Status:** in-progress · rzy · 2026-09-11

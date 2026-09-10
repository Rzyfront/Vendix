---
id: A.5
title: "prueba-regresion-y-convergencia"
phase: A
status: in-progress
owner: none
updated: 2026-09-10
contracts: []
adrs: []
skills: [how-to-test, pr-code-review, agent-teams]
---
# A.5 — prueba-regresion-y-convergencia

- **Skills:** how-to-test, pr-code-review, agent-teams
- **Resources:** bundle `evidence/`, `cp-lint.sh`, `cp-ledger.sh`, perspectives matrix
- **Business decision:** Nothing merges without end-to-end proof per flow plus two clean audit rounds.
- **Why:** Fiscal flows fail silently by default (warn-only, fire-and-forget); only executed evidence counts.
- **Output:** Green matrix: web, whatsapp, POS, drafts, table close-out, send/accept, credit notes; `cp-lint.sh` exit 0; convergence log with two clean rounds; `pr-code-review` ≥ 80%.
- **Contracts touched:** none — verification only.
- **Data impact:** none — sandbox/test tenants only; no prod writes during verification.
- **Blast radius:** none (reads + sandbox).
- **Rollback:** n/a — no changes in this step.
- **Verification:**
  - `bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-facturacion-fixes` → exit 0
  - each FB/DB/ERR row `[x]` with evidence file linked
- **Acceptance checklist:**
  - [ ] all registry rows verified with evidence
  - [ ] two consecutive perspective rounds with zero new blocker/major
  - [ ] pr-code-review ≥ 80% on the fix PR
- **Status:** in-progress

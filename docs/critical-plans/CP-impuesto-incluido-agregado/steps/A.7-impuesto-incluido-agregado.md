---
id: A.7
title: "Convergencia, PR, review y deploy"
phase: A
status: pending
owner: none
updated: 2026-09-10
contracts: []
adrs: []
skills: [git-workflow, pr-code-review, how-to-dev]
---
# A.7 — Convergencia, PR, review y deploy

- **Skills:** git-workflow, pr-code-review, how-to-dev
- **Resources:** `log/convergence.md`, rama `fix/CP-impuesto-incluido-agregado`, PR contra `develop`
- **Business decision:** Nada se mergea sin dos rondas limpias consecutivas, review ≥80% y autorización explícita de merge (regla vigente del usuario).
- **Why:** La Fase 7 es donde mueren los planes críticos: ejecutar sin actualizar el bundle ni converger.
- **Output:** Dos rondas de convergencia registradas, PR con bundle (`git add -f docs/critical-plans/CP-impuesto-incluido-agregado`), review ≥80%, merge a `develop`, memorias Engram.
- **Contracts touched:** none — cierre y gobierno, no contratos nuevos.
- **Data impact:** Deploy aplica migración A.1 en el pipeline (`prisma migrate deploy` en release); backfill corre una vez.
- **Blast radius:** Release estándar a `develop`; migración aditiva con default seguro.
- **Rollback:** Revert del merge; migración ya aplicada se deja (columna sin uso) o se revierte con correctiva.
- **Verification:**
  - `cp-ledger.sh` + `cp-lint.sh` exit 0, ledger sin blockers ni findings abiertos
  - `pr-code-review` ≥ 80% + gates git-workflow R5–R8
  - CI aplica la migración en staging sin P3009
- **Acceptance checklist:**
  - [ ] Dos rondas consecutivas sin blocker ni major nuevos
  - [ ] PR con bundle forzado (`docs/` va con `-f`) y evidencias linkeadas
  - [ ] Review ≥80% y aprobación explícita de merge registrada
  - [ ] Deploy corre migración; smoke: producto inclusivo vende a precio publicado
- **Status:** pending

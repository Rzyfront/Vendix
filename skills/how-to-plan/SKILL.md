---
name: how-to-plan
description: >
  Vendix planning protocol for large work: the ODD feature doc odd/tasks/<feature>.md (Specs/Tasks/Log) approved by Rafael before execution.
  Trigger: /how-to-plan, an explicit plan request, or work that fails the resumption test.
disable-model-invocation: true
license: MIT
metadata:
  author: rzyfront
  version: "4.0"
  scope: [root]
---

# How To Plan

Decide **whether** a change needs a plan and, when it does, write an **ODD feature document** that
Rafael approves before execution. Every plan starts from a **user story** a person can test on screen.

## Small vs Large — the Resumption Test

Size is **not** lines or files. Ask: *could another agent resume this work with only the original
request plus `git diff`?*

| Answer | Class | What to do |
|--------|-------|------------|
| Yes | **Small** | Work inline. No plan, no feature doc, no subagents. The closing summary still states the user story, the human test steps and what the person sees. |
| No | **Large** | Write `odd/tasks/<feature>.md`, present it, and wait for Rafael's approval before touching code. |

Also write a feature doc when Rafael explicitly asks for a plan. If you see critical risk (money, DIAN,
inventory valuation, payroll, auth, tenant scope, row-mutating migration), name it in one or two
sentences under Specs and mark it for RDD.

## Plan State Rules

| Situation | Action |
|-----------|--------|
| Approved doc + "ejecuta" / "apruebo" / "procede" | Execute it **as written**, in order. Do not replan. |
| Doc exists + plan mode | Review/refine the doc only. No code. |
| Error during execution | Fix it inside the plan and record it in `## Log`. |
| A task or a business decision must change | Stop and ask Rafael. Replan only when asked. |

## The Feature Document

Path: `odd/tasks/<feature>.md` (kebab-case). Living document: tick tasks and append to the log.
The **user story goes first**; technical detail goes below it as implementation notes, never as the axis.

```markdown
# <Feature title>

## User story
Como <rol/usuario> en <entorno: panel, app, POS, tienda online…>, quiero <funcionalidad> para <resultado>.

**Pasos para reproducir / probar (humanos, en pantalla):**
1. Inicia sesión como <usuario seed> en <URL>.
2. Ve a <menú > pantalla> y haz <acción>.
3. ...

**Criterios de aceptación (observables y medibles):**
- [ ] Al <acción>, la persona ve <resultado concreto: texto, total, estado, mensaje>.
- [ ] <caso de error / borde>: ve <mensaje o bloqueo>.

## Specs
**Context:** 2-5 sentences — problem, trigger.
**Business decisions:** each rule this change enforces.
**Approach:** chosen approach and why; one rejected alternative with reason.
**Critical files:** concrete paths only (no wildcards), each with its role.
**Reusable assets:** paths found in Reuse Discovery, or "none — <rationale>".
**Verification (end-to-end):** the human steps above + exact commands that prove them.
**Knowledge gaps:** missing or outdated skills, or "None."

## Tasks
- [ ] T1 — <name> · Skills: <skill-a> · Files: <paths> · Verify: <exact command or human step>

## Log
- YYYY-MM-DD — Plan written; awaiting Rafael's approval.
- YYYY-MM-DD — T1 done: <evidence: test output, curl status, screenshot, commit sha>.
```

Rules:

- A bug fix's story describes the broken behavior: the steps reproduce it, the criteria say what the
  person sees once fixed.
- Every task names its skills (or `Knowledge gap`) and an **exact** verification.
- Destructive steps still need explicit confirmation at execution time (`vendix-prisma-migrations`).
- No `Assumptions` / `Notes` / `Risks` sections — fold them into Specs.
- Present the doc and wait for an explicit approval word; never ask "¿está bien el plan?" mid-text.

Good vs rejected field examples, the skill selection matrix and the verification catalog live in
`references/plan-reference.md` — read it while drafting.

## Reuse Discovery (before proposing new code)

- [ ] Grep related symbols, types and services (`grep -rn "ConceptName" apps/`).
- [ ] Read the SKILL.md of every affected domain.
- [ ] Scan `apps/frontend/src/app/shared/`, `apps/backend/src/common/` and `libs/`.

Duplication (a second `CurrencyFormatService`, a parallel modal wrapper) is a planning failure.

## Closing the Work

- Tick every task and append evidence to `## Log`; the final report repeats the story and how the
  person verifies it.
- Local commits per unit of work; push / PR only when Rafael asks (`git-workflow`, `pr-code-review`).
- Durable decisions go to Engram (`vendix-engram`). Finished docs: `purge-plans`.

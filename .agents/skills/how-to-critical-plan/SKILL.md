---
name: how-to-critical-plan
description: >
  Planning protocol for mission-critical, large-scale work that cannot fail. Produces a fragmented plan bundle (hub + steps + registries + findings) so no actor loads more than ~8k tokens of plan.
  Trigger: EXPLICIT INVOCATION ONLY. Fires only when the user asks in their own words for a critical plan, a massive plan, or a plan that cannot fail, or when the user names or links this skill. Never inferred from how critical the work looks. For everything else — trivial or complex but not critical — use `how-to-plan`.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "User explicitly asks for a critical plan (plan crítico, critical plan)"
    - "User explicitly asks for a massive, huge, or ultra-detailed plan (plan masivo, plan gigante, plan súper grande)"
    - "User explicitly says the work cannot fail (esto no puede fallar, cero margen de error)"
    - "User names or links the how-to-critical-plan skill"
    - "User explicitly asks for a plan with checklists that tracks execution progress for handoff"
    - "User explicitly asks for a full contract sweep (frontend to backend, and database) as part of a plan"
    - "User explicitly asks for parallel multi-perspective auditing of a plan or its implementation"
---

# How To Critical Plan

## Purpose

Planning protocol for work that **cannot fail**: critical system functions, or changes broad enough that one
unnoticed contract break corrupts data, breaks a tenant, or silently produces wrong money. `how-to-plan`
optimizes for speed of approval; this skill optimizes for **exhaustiveness and zero tolerance to failure**.
A critical plan is not a summary of the work — it *is* the work, written before it happens and kept alive.

1. **Exhaustive, not representative.** 50 contracts touched → 50 registry rows → 50 verifications. "Etc." is a format break.
2. **A living document.** Anyone can open it cold and resume from the file alone.
3. **Self-verifying.** Thirteen independent perspectives audit the result until two consecutive rounds are clean.
4. **Bounded context.** The plan is a *bundle* of one-role fragments referenced by ID. Nothing is summarized, nothing is co-located: each actor loads only its package.

## Invocation — Explicit Only

**This skill never activates on its own judgment.** If the human did not ask, it does not run. **The only two triggers:** the user asks in their own words ("hazme un plan crítico", "plan masivo", "esto no puede fallar", "plan gigante con checklists") or names/links the skill. **Complex is not critical.** Trivial → no plan; normal, complex or multi-domain → `how-to-plan`; complex **and** the user asked → this skill.

**Never self-escalate — suggest instead.** Under `how-to-plan`, if you conclude the work carries critical risk, name the risk in one or two sentences and continue the plan you were asked for:

> "Heads-up: this touches the DIAN numbering, where a duplicated consecutive is unrecoverable. Continuing with the normal plan — say the word if you want a critical plan (`how-to-critical-plan`, substantially longer)."

**Signals worth mentioning when you suggest it** (never triggers): money, fiscal/DIAN, inventory valuation, payroll, subscriptions, auth, tenant scoping · not recoverable by a follow-up commit · 5+ endpoints or models at once · a row-mutating migration · more than one session.

**Downgrading.** If Phase 1 shows the work is smaller than believed, say so and offer `how-to-plan`. A ceremonial critical plan teaches people to skim.

## Core Rules

- **Explicit invocation only.** Suggest, then continue with what was asked.
- **Zero compaction, zero co-location.** Every decision, trade-off and assumption is written out in full — in the fragment that owns it. Budgets: hub ≤ 8k tokens · step ≤ 2.5k · ADR ≤ 1.5k · finding ≤ 800 · registry row ≤ 400 chars · log row ≤ 300 · checklist item ≤ 200. `cp-lint.sh` fails the plan when one is exceeded. A step that does not fit is two steps.
- **The plan is a bundle** under `docs/critical-plans/CP-<slug>/`, created with `cp-new.sh`, validated with `cp-lint.sh`. Format: `references/format.md`. Only the fragments defined there exist.
- **Every step carries ALL TWELVE fields**, in order: `Skills`, `Resources`, `Business decision`, `Why`, `Output`, `Contracts touched`, `Data impact`, `Blast radius`, `Rollback`, `Verification`, `Acceptance checklist`, `Status`. Every step ends in a `- [ ]` checklist — the unit of progress.
- **A finding is a first-class record** (`findings/F-nnn.md`). In its owning step it is exactly one checklist line — `- [ ] F-nnn — <title> (<severity>)` — whose mark flips in place when it closes. Rationale goes to the finding or an ADR, never to a checklist item.
- **Ledger and index are generated** by `cp-ledger.sh` — never hand-written. **Evidence lives in `evidence/`** inside the bundle, never `/tmp`.
- **Contract completeness is absolute.** Every frontend↔backend contract, database read/write point and failure path touched gets its own registry row and verification. No sampling. **No raw 500**: every failure path resolves to a registered error code with HTTP status and frontend behavior.
- **Findings close only by a fix or a recorded human decision.** Re-rating a severity to close a round is the most dangerous anti-pattern.
- Never list `how-to-plan` or `how-to-critical-plan` as a step skill.

## The Bundle

```
docs/critical-plans/CP-<slug>/
├── PLAN.md        hub: identity · generated ledger + index · context · criticality · objectives ·
│                  phases · approach · blast radius · data integrity · rollback · approval
├── adr/           ADR-nn-<slug>.md — one decision per file
├── registry/      fb.md · db.md · err.md — one line per contract row
├── steps/         A.1-<slug>.md — one step per file, twelve fields
├── findings/      F-nnn.md — one finding per file
├── log/           execution.md · convergence.md
├── inventory/     files.md · assets.md
└── evidence/      verification outputs
```

Fragments carry flat YAML frontmatter, parsed with awk alone.

### Read protocol — who loads what

| Actor | Loads | Command |
|-------|-------|---------|
| Human / orchestrator, cold start | the hub only | `cp-context.sh <bundle> hub` |
| Executor of step X | the step, its registry rows, its ADRs | `cp-context.sh <bundle> step X` |
| Perspective agent *n* | hub brief + its domain registry + the steps it audits | `cp-context.sh <bundle> perspective n A.1 A.2` |
| Contract sweep | one registry | `cp-context.sh <bundle> sweep fb\|db\|err` |
| Convergence dedup | `findings/`, every status | the directory |

Nobody is handed the whole bundle.

### Write protocol — growth without bloat

- New decision → `cp-new.sh adr`. New finding → `cp-new.sh finding` + one checklist line in the owning step.
- Closing a finding flips its existing line (`[x] → evidence/…`, or `[-]` with `Descartado:` and the authorizer). Never a second line.
- Execution Log rows ≤ 300 chars; detail goes to `evidence/`, the row links it.
- After any status change → `cp-ledger.sh`. Before closing a phase or recording a round → `cp-lint.sh` exit 0.

## The Seven Phases

| Phase | Goal | Output | Max agents |
|-------|------|--------|------------|
| **1. Exhaustive Understanding** | Map every file, symbol, consumer, caller. No sampling. | `inventory/files.md`, `inventory/assets.md` | 4 |
| **2. Contract Mapping** | Enumerate the three registries **before** any design | `registry/fb.md`, `db.md`, `err.md` | 4 |
| **3. Design** | Competing approaches, ADRs, blast radius, rollback | `adr/*.md`, hub sections | 3 |
| **4. Adversarial Review** | Thirteen perspectives attack the design before code exists | `findings/*.md`, revised ADRs/steps | 4 |
| **5. Final Plan** | `cp-new.sh`, write every fragment, `cp-lint.sh` exit 0 | Bundle, checklists unticked, hub `status: planning` | 0 |
| **6. Approval** | Present the hub; obtain "ejecuta" / "apruebo" / "procede" | hub `status: approved` | 0 |
| **7. Execution & Convergence** | Execute with `cp-context step`; audit until two clean rounds | All ticked, convergence closed, hub `status: done` | 4 |

**Phase-specific rules:**

- **Phase 1** produces an inventory, not an impression: concrete files with roles, not "the invoicing domain".
- **Phase 2 is why this skill exists.** You cannot design safely against contracts you have not enumerated; a registry filled after the code protects nothing.
- **Phase 4** is adversarial by construction: "looks good" without an attack narrative means the perspective did not run.
- **Phase 5** edits only the bundle. Approval uses the hub's `## Approval Request` block, never `AskUserQuestion`.
- **Phase 7 is where critical plans die** — by executing without updating the bundle. Executors get `cp-context step <id>`; every closed step is followed by `cp-ledger.sh`; every phase closes with the contract sweep gate and `cp-lint.sh`.

## Tooling

Four scripts in `skills/how-to-critical-plan/assets/` (bash + awk, no dependencies, `--help` on each):

| Script | Use |
|--------|-----|
| `cp-new.sh <slug>` · `cp-new.sh step <b> A.1 "<title>"` · `cp-new.sh adr <b> "<title>"` · `cp-new.sh finding <b> "<title>" --sev major --persp 3 --round 1 --step A.1 --loc "<path:line>"` | Scaffold the bundle or a fragment from `assets/templates/` |
| `cp-lint.sh <bundle>` | Structure, twelve fields, vocabularies, budgets, dangling refs, duplicated or unfiled findings, `/tmp` evidence. Exit 1 on any failure. |
| `cp-ledger.sh <bundle>` | Regenerate ledger and index between their markers. Idempotent. |
| `cp-context.sh <bundle> hub\|step\|perspective\|sweep …` | Print one actor's package; size in tokens on stderr |

## Agent Strategy — the Perspective Fleet

Thirteen mandatory perspectives (architecture · implementation · frontend↔backend contracts · database contracts & integrity · error handling & codes · security & authorization · data validation · data load & performance · development strategy · UI/UX & reachability · accessibility · user comprehension · observability & traceability), each blind to the others, in waves of at most **4 concurrent** through `agent-teams`. Each receives only `cp-context perspective n <steps>` plus the instruction to *break* the design, and returns a findings list — never a narrative — that the orchestrator files with `cp-new.sh finding`. Perspectives never write code; fixes become steps. `N/A` needs a written reason. Tables, severities, prompt template: `references/perspectives.md`.

## Convergence Loop

Phase 7, after execution: audit the **current** state with all thirteen perspectives → file new findings (dedup against *all* of `findings/`, not the fixed ones) → fix every blocker and major as plan steps → record the round in `log/convergence.md` → `cp-ledger.sh` → repeat until **two consecutive rounds** yield zero new blocker or major, varying entry points on the second. Floor two rounds; at six, escalate — the design is suspect. Rules: `references/convergence.md`.

## Validation

Before requesting approval and before closing any phase or round: `cp-lint.sh` exit 0, then the human-judgment checklist and anti-patterns in `references/validation-checklist.md` (criticality quotes the request, blast radius names concrete outcomes, registry counts equal the Phase 2 inventory, every `withoutScope()` justified, every verification runnable, data-integrity gates).

## User Interaction Boundary

| Question type | Channel |
|---------------|---------|
| Choose between approaches · resolve an ambiguity grep cannot answer (Phase 3) | `AskUserQuestion` |
| Approval of the finished plan (Phase 6) | The hub's `## Approval Request` block |
| Destructive or irreversible action | Inline confirmation naming the consequence |
| Accept a finding without fixing it (Phase 7) | Inline; finding `status: accepted` + `accepted_by`, step line `[-]` |
| Non-converging loop (6+ rounds) | Inline, stating that the design is suspect |

## Relationship With Development

Execution runs under `how-to-dev`: load every skill in the step's `Skills` · work from `cp-context step <id>`, never the whole bundle · update step `status`, checklist and `log/execution.md` **as you go**, then `cp-ledger.sh` · never tick a box before its `Verification` ran · contract sweep gate + `cp-lint.sh` before closing a phase · convergence loop before closing the plan · preserve every `Business decision` and ADR.

**Gates before "done"** — `git-workflow` RULES 5–8, plus: every `FB-*`, `DB-*`, `ERR-*` row `[x]` with evidence · thirteen perspectives run and resolved or explicitly accepted · two consecutive clean rounds · ledger shows every phase complete, no open blocker · `cp-lint.sh` exit 0 · `pr-code-review` ≥ 80%. Any unmet gate means not done.

## Related Skills

- `how-to-plan` — six base step fields, Skill Selection Matrix and Verification Mechanisms Catalog inherited unchanged · `how-to-dev` · `agent-teams` · `how-to-test` (curl for contracts, Playwright MCP for E2E).
- `vendix-error-handling` (Registry 3) · `vendix-prisma-migrations` (Data Integrity) · `vendix-prisma-scopes` / `vendix-multi-tenant-context` (Registry 2) · `vendix-backend-api` / `vendix-validation` (Registry 1) · `pr-code-review` · `vendix-engram` · `skill-creator`.

## Changelog

- **v2.0** — The plan becomes a **bundle**. Diagnosis: 13 `CP-*` plans totalled 1.58 MB (largest 732 KB ≈ 183k tokens; typical 333 KB ≈ 83k, half of it steps). One file served five roles, every actor loaded all five, and findings were pasted inline then closed with a second line. v2.0 keeps every v1.1 rule and changes only where things live and who reads what: hub + fragments, hard budgets, findings as records, generated ledger/index, evidence inside the bundle, four scripts, `references/`. Single-file plans remain historical v1 documents.
- **v1.1** — Explicit invocation only; `Criticality Justification` quotes the request.
- **v1.0** — Seven phases with Contract Mapping before design, twelve fields, three registries, thirteen perspectives, convergence loop, Living Document Protocol.

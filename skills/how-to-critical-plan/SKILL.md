---
name: how-to-critical-plan
description: >
  Planning protocol for mission-critical, large-scale work that cannot fail.
  Trigger: EXPLICIT INVOCATION ONLY. Fires only when the user asks in their own words for a critical plan, a massive plan, or a plan that cannot fail, or when the user names or links this skill. Never inferred from how critical the work looks. For everything else — trivial or complex but not critical — use `how-to-plan`.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
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

Define the planning protocol for work that **cannot fail**: changes to critical system functions, or
changes broad enough that a single unnoticed contract break corrupts data, breaks a tenant, or
silently produces wrong money.

`how-to-plan` optimizes for *clarity and speed of approval*. This skill optimizes for **exhaustiveness
and zero tolerance to failure**. It is deliberately, unapologetically verbose. A critical plan is not a
summary of the work — it **is** the work, written down before it happens, and kept alive while it
happens.

Three properties separate a critical plan from a normal one:

1. **It is exhaustive, not representative.** If the work touches 50 service contracts, the plan lists
   50 rows and verifies 50. If it touches 30 database points, it lists 30 and verifies 30. Sampling,
   "and others", "etc." and "the rest follow the same pattern" are format breaks, not shortcuts.
2. **It is a living document.** Execution updates it. At any moment, anyone can open the file and see
   exactly which checklist items are done, which are in progress, which are blocked and why. If the
   person executing it disappears, the next person picks it up from the file alone.
3. **It self-verifies until it converges.** After execution, a fleet of independent perspectives audits
   the result. Every finding becomes a new checklist item. The loop repeats until two consecutive
   rounds produce no new blocker or major findings.

## Invocation — Explicit Only

**This skill never activates on its own judgment.** It does not matter how critical, how large, or how
dangerous the work looks: if the human did not ask for it, it does not run.

### The only two triggers

| Trigger | Examples of what the user said |
|---------|-------------------------------|
| **The user asks for it in their own words** | "hazme un plan crítico", "necesito un plan masivo", "esto no puede fallar", "quiero un plan súper detallado con checklists", "plan gigante para esto" |
| **The user names or links the skill** | "usa `how-to-critical-plan`", "/how-to-critical-plan", pasting the path to `skills/how-to-critical-plan/SKILL.md` |

Anything else — including work that this skill would obviously fit — goes to `how-to-plan`.

### Complex is not critical

`how-to-plan` covers **both** ends of the normal range: a trivial one-file change and a genuinely
complex multi-domain feature. Complexity alone never escalates. What this skill adds is not capacity for
complexity; it is a tolerance of zero for failure, paid for with days of extra work.

| The work is… | Skill |
|--------------|-------|
| Trivial | No plan (global rule 2.3) |
| Normal | `how-to-plan` |
| Complex, multi-domain, many files | `how-to-plan` |
| Complex **and** the user asked for a critical plan | `how-to-critical-plan` |

### Never self-escalate — suggest instead

If, while planning under `how-to-plan`, you conclude the work carries critical risk, you do **not**
switch. You say so in one or two sentences, name the risk, and continue with the plan you were asked
for. The human decides.

> "Heads-up: this touches the DIAN numbering, where a duplicated consecutive is unrecoverable. I'm
> continuing with the normal plan as asked — say the word if you want a critical plan instead
> (`how-to-critical-plan`: contract registries, checklists, and a multi-perspective audit loop; it takes
> substantially longer)."

Then keep going. Blocking on the question, or silently producing a critical plan because it felt safer,
are both failures.

### Signals worth mentioning when you suggest it

These do **not** trigger the skill. They are what makes a suggestion worth voicing at all.

| Signal | Example |
|--------|---------|
| The change touches a critical function | Money, pricing, fiscal/DIAN emission, inventory valuation, payroll, subscriptions, authentication, tenant scoping |
| Failure is not recoverable by a follow-up commit | A burned DIAN consecutive, a corrupted stock ledger, an invoice emitted with the wrong NIT, a deleted row |
| The change spans many contracts at once | 5 or more frontend-to-backend endpoints, or 5 or more database models |
| The change includes a migration that mutates rows | Backfills, column type changes, re-keying, de-duplication |
| The work spans more than one working session | Anything likely to be handed off, or returned to after a week |

### Downgrading

If the user invoked this skill and Phase 1 shows the work is smaller than believed, say so explicitly
and offer to switch to `how-to-plan`. Do not quietly produce a thin critical plan: the format's weight
is what makes people read the checklists, and a ceremonial one teaches them to skim.

## Core Rules

- **Explicit invocation only.** Never escalate a plan into a critical plan on your own judgment. See
  `Invocation — Explicit Only`. Suggest, then continue with what was asked.
- **Zero compaction.** Brevity is not a virtue here. Every decision, every trade-off, every assumption,
  every structure, every strategy is written out in full. If a reader has to ask "why did they do it
  this way", the plan failed.
- **Every step carries ALL TWELVE mandatory fields**, in this order: `Skills`, `Resources`,
  `Business decision`, `Why`, `Output`, `Contracts touched`, `Data impact`, `Blast radius`,
  `Rollback`, `Verification`, `Acceptance checklist`, `Status`. A missing field invalidates the plan.
- **Every step ends in a checklist.** Not prose describing what "should" happen — `- [ ]` items a human
  ticks off one by one. The checklist is the unit of progress, not the step.
- **The plan is updated during execution.** Ticking boxes, filling `Status`, appending to the
  `Execution Log` and the `Convergence Loop Log` are part of the work, not paperwork after it.
- **Contract completeness is absolute.** Every frontend-to-backend contract touched gets a row in the
  registry and an individual verification. Every database read/write point touched gets a row and an
  individual verification. No sampling, ever.
- **No raw 500 is acceptable.** Every failure path resolves to a registered, standardized error code
  with a defined HTTP status and a defined frontend behavior.
- **Findings can only be closed by fixing them or by a recorded human decision.** Lowering a severity
  to close a round is prohibited and is the single most dangerous anti-pattern in this skill.
- **Never list `how-to-plan` or `how-to-critical-plan` as a step skill** — they govern the planner, not
  the executor.
- The plan contains **only** the sections defined in `Required Critical Plan Format`. Adding ad-hoc
  sections is forbidden; fold the content into the section that owns it.

## The Seven Phases

A critical plan flows through seven phases. Phases are sequential. Phase 7 does not end when the code
is written — it ends when the convergence loop closes.

| Phase | Goal | Tools | Output | Max concurrent agents |
|-------|------|-------|--------|-----------------------|
| **1. Exhaustive Understanding** | Map every file, symbol, consumer and caller in scope. No sampling. | `Explore`, `Read`, `grep`, skill lookup | Complete inventory of affected surface | 4 |
| **2. Contract Mapping** | Build the three registries BEFORE any design: frontend↔backend, database, error codes | `grep` over DTOs, interfaces, Prisma models; live `curl` against current behavior | Three populated registries with one row per touched point | 4 |
| **3. Design** | Generate competing approaches, record ADRs, define blast radius and rollback | `Plan` agents, web research for standards | Approaches compared, ADRs written, rollback defined per phase | 3 |
| **4. Adversarial Review** | Attack the chosen design from every perspective before a line is written | Perspective fleet (see Agent Strategy) | Findings list; design revised until no blocker survives | 4 |
| **5. Final Plan** | Write the document in the required format | `Write` / `Edit` on the plan file only | Complete plan file, all checklists unticked, `Status: pending` | 0 |
| **6. Approval** | Present and obtain explicit human confirmation | Formal approval block | "ejecuta" / "apruebo" / "procede" | 0 |
| **7. Execution & Convergence** | Execute step by step, updating the plan; then audit until two clean rounds | `how-to-dev`, perspective fleet, contract sweeps | Every checklist ticked; convergence log closed | 4 |

### Phase-specific rules

- **Phase 1** must produce an inventory, not an impression. "The invoicing domain" is not an inventory;
  a list of 34 concrete files with their role is. If the inventory cannot be completed, the plan is not
  ready — say so rather than guessing.
- **Phase 2 is the phase that makes this skill worth using.** It happens *before* design on purpose:
  you cannot design safely against contracts you have not enumerated. A plan whose registries were
  filled in retroactively, after the code was written, provides no protection.
- **Phase 4 is adversarial by construction.** Each perspective agent is prompted to *break* the design,
  not to validate it. An agent that returns "looks good" without having tried to break it did not run
  the phase.
- **Phase 5 edits only the plan file.** No source changes.
- **Phase 6 uses the formal approval block**, never `AskUserQuestion`.
- **Phase 7 is where most critical plans die.** They die by being executed without updating the plan,
  which destroys the handoff property and makes the convergence loop impossible to run.

## Agent Strategy — the Perspective Fleet

Critical plans are audited by **independent perspectives**, each blind to what the others found. A
single reviewer, however careful, has one failure mode and applies it uniformly.

### The thirteen mandatory perspectives

Every critical plan must be audited from all thirteen. Perspectives that genuinely do not apply
(for example accessibility on a backend-only change) are marked `N/A` **with a written reason** — never
silently dropped.

| # | Perspective | Owns | Sample finding it must catch |
|---|-------------|------|------------------------------|
| 1 | **Architecture** | Boundaries, coupling, ownership, module graph, cycles | A domain importing another domain's service by path, creating a cycle at boot |
| 2 | **Implementation** | Files, ordering, dependencies, dead code, duplication | A second implementation of a service that already exists in `common/` |
| 3 | **Frontend↔Backend contracts** | Request/response shape, field presence, types, optionality | The backend stops returning a field a component reads without a guard |
| 4 | **Database contracts & integrity** | Models, columns, scoping, migrations, invariants, orphans | A query that drops the tenant filter inside a `$transaction` |
| 5 | **Error handling & codes** | Every failure path, standardized codes, HTTP statuses | A `throw new Error()` that reaches the client as a raw 500 |
| 6 | **Security & authorization** | Permissions, tenant isolation, IDOR, secret handling | A `where: { id }` lookup reachable across tenants |
| 7 | **Data validation** | DTOs, bounds, nulls, types, coercion, whitelisting | A `number` field accepting a string that becomes `NaN` downstream |
| 8 | **Data load & performance** | Volume, N+1, indexes, pagination, connection pool | A loop issuing one query per row inside a transaction |
| 9 | **Development strategy** | Sequencing, reversibility, feature flags, deploy order | A migration that must land before the code but is scheduled after |
| 10 | **UI/UX & reachability** | Where the function lives, how many clicks, discoverability | A new function reachable only by typing the URL |
| 11 | **Accessibility** | Keyboard, focus, contrast, labels, screen readers | An icon-only action button with no accessible name |
| 12 | **User comprehension** | Copy, empty states, loading states, error messages, help | An error that says "Error 422" instead of what to fix |
| 13 | **Observability & traceability** | Logs, correlation ids, audit trail, silent failures | A `catch {}` that swallows the only evidence a step ran |

### Orchestration rules

- Route through `agent-teams`. Maximum **4 concurrent** agents; run the thirteen perspectives in
  **waves**. The cap is on concurrency, not on coverage — all thirteen must run.
- Each perspective agent receives: the goal in one sentence, its perspective and *only* its perspective,
  the concrete file list from Phase 1, the relevant registries from Phase 2, and the explicit
  instruction to attempt to break the design.
- Each agent returns a **findings list**, never a narrative. Each finding carries: perspective,
  severity (`blocker` / `major` / `minor` / `note`), the concrete location, the failure scenario
  (inputs → wrong outcome), and a proposed fix.
- The orchestrator merges findings, deduplicates, and files each one as a checklist item under the step
  that owns it. Findings that belong to no existing step create a new step.
- **Never let a perspective agent write code.** They investigate and report. Fixes are executed as plan
  steps, under `how-to-dev`, so they inherit the same twelve fields and the same verification.

### Severity definitions

| Severity | Meaning | Effect on the loop |
|----------|---------|--------------------|
| `blocker` | Produces wrong data, data loss, a security hole, or an unrecoverable state | Round is not clean. Must be fixed. |
| `major` | Breaks a contract, produces a raw 500, or degrades a critical path | Round is not clean. Must be fixed. |
| `minor` | Works but is fragile, duplicated, or unclear | Round can be clean. Fix or record a decision. |
| `note` | Observation for future work | Does not affect the loop. Goes to `Knowledge Gaps`. |

## Contract Discipline

This is the section the skill exists for. **A contract break is the failure mode critical work dies
from**, because it passes every build, every type check and every unit test, and shows up in production
as a blank screen, a wrong number, or a 500 with no explanation.

### Why a type check is not a contract verification

`tsc` proves the code agrees with the **declared** interface. It cannot prove the declared interface
agrees with what the server **actually sends**. A frontend interface that says `total: number` compiles
perfectly against a backend that sends `total: string` — and breaks at runtime on the first
`.toFixed()`.

**A contract is verified only by comparing a live response against the declared shape.** Both sides.
Every time.

### The four failure modes every contract check must rule out

| Failure mode | Symptom in production |
|--------------|-----------------------|
| **Field of more** — the client sends a field the server rejects | 400 with `forbidNonWhitelisted`, or a silently ignored value |
| **Field of less** — the client omits a field the server requires, or the server stops sending one the client reads | 400 on write; `undefined` propagating into the UI on read |
| **Type mismatch** — same field name, different type | `NaN`, `Invalid Date`, `[object Object]` rendered to the user |
| **Optionality mismatch** — required becomes optional or vice versa | Works for every existing row and breaks on the first new one |

### Registry 1 — Frontend↔Backend Contract Registry

One row per endpoint touched by the plan. **No exceptions, no grouping, no "same as above".**

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `POST /api/store/x` | `CreateXDto` | `{ data: X }` | `x-create.component.ts:412` | `+ field y: number` | Type mismatch | `curl … \| jq 'keys'` vs `X` interface | `- [ ]` |

Rules:

- The `Change` column names the **exact** delta: `+ field`, `- field`, `field renamed a→b`,
  `field type number→string`, `field required→optional`, `none (regression check only)`.
- Endpoints the plan does **not** change but whose consumers it touches still get a row, marked
  `none (regression check only)`. A component refactor breaks contracts just as effectively as a DTO edit.
- `Verification` is a runnable command, not a description. The canonical form compares live keys against
  the declared interface — never just "check it returns 200".
- `Status` is a checkbox that a human ticks after running the verification, not after reading the code.

### Registry 2 — Database Contract Registry

One row per database read/write point touched. **If the plan touches 30 points, there are 30 rows.**

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `invoices` | `total`, `state` | W | `store_id` via scoped client | `2026…_x` | `invoicing.service.ts:871` | `total = sum(items) + taxes` | `SELECT …` proving the invariant | `- [ ]` |

Rules:

- **`Tenant scoping` is mandatory on every row.** Write which mechanism applies: scoped client,
  `withoutScope()` with an explicit filter, fiscal-entity scope, or relational scope. `withoutScope()`
  without a written justification is a `blocker` by definition.
- **`Invariant` is the property that must hold before and after.** A row without an invariant is a row
  nobody can verify. If the invariant is "none", write why.
- Every migration that mutates rows also carries the `-- DATA IMPACT:` header and the checklist required
  by the global migration rules and `vendix-prisma-migrations`. That is a hard gate, not a suggestion.
- **Verification runs against a representative dataset**, never an empty local database. A migration
  that passes on zero rows has proven nothing.

### Registry 3 — Error Code Registry

One row per failure path the plan creates or touches.

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `INVOICING_AREA_001` | 409 | Fiscal area inactive | Blocks submit, shows banner | "La facturación no está activa…" | `curl` on a store with the area off | `- [ ]` |

Rules:

- **Every path is registered.** If a path can throw, it has a row. `throw new Error('...')` reaching a
  controller is a `blocker`: it becomes a raw 500 with no code the frontend can branch on.
- The `Frontend behavior` column is mandatory. An error code nobody handles is an unhandled error with
  extra steps.
- Codes come from the project's standardized catalog. Inventing a code inline without registering it in
  the catalog is a format break — see `vendix-error-handling`.
- **Beware the 200-with-`success:false` shape.** A handler that catches its own exception and returns a
  success envelope produces a failure the frontend renders as data. Register which shape each path uses.

### Contract sweep gate

Before the plan can be declared done:

- [ ] Every `FB-*` row has `Status: [x]`, ticked after running its verification against a live server.
- [ ] Every `DB-*` row has `Status: [x]`, ticked after running its invariant query on real data.
- [ ] Every `ERR-*` row has `Status: [x]`, ticked after provoking the error and observing the frontend.
- [ ] The count of rows equals the count of touched points found in Phase 2. A shrinking registry means
      something was dropped, not that the work got smaller.

## Living Document Protocol

The plan file is the single source of truth for progress. It is edited continuously during Phase 7.

### Checkbox vocabulary

| Marker | Meaning | Required companion |
|--------|---------|--------------------|
| `- [ ]` | Pending | — |
| `- [~]` | In progress | Owner + start date on the same line |
| `- [x]` | Done **and verified** | Evidence: command output, PR link, screenshot path |
| `- [!]` | Blocked | A `Blocker:` line stating what is blocking and who can unblock |
| `- [-]` | Deliberately skipped | A `Descartado:` line with the reason and **who authorized it** |

`- [x]` means verified, not written. Ticking a box because the code was typed is the most common way a
critical plan becomes fiction.

### The Execution Ledger

Kept at the top of the file, immediately after the plan identity. It is what a person reads first when
a plan is handed to them cold.

```markdown
## Execution Ledger

| Phase | Steps | Done | In progress | Blocked | Status |
|-------|-------|------|-------------|---------|--------|
| A — Foundations | 6 | 6 | 0 | 0 | ✅ Complete |
| B — Contracts   | 9 | 4 | 1 | 1 | 🟡 In progress |
| C — Frontend    | 7 | 0 | 0 | 0 | ⬜ Not started |

**Current position:** Phase B, step B.5 (`Contract sweep of the orders endpoints`).
**Owner:** <name> · **Last updated:** <YYYY-MM-DD>
**Open blockers:** B.6 — waiting on the DIAN to authorize the second numbering range.
**Handoff notes:** B.4 left a scratch script at `<path>`; rerun it before continuing B.5.
```

Rules:

- The ledger is updated **at the end of every working session**, without exception. A ledger whose
  `Last updated` is older than the newest ticked checkbox is stale, and a stale ledger is worse than no
  ledger — it is believed.
- `Handoff notes` is not optional prose. It is what the next person needs and cannot derive from the
  file: half-finished branches, scratch scripts, credentials used, decisions taken verbally.
- **Never delete a blocker line when it resolves.** Move it to the `Execution Log` with its resolution.
  The history of what blocked the work is evidence the next reader needs.

### The Execution Log

Appended, never rewritten. One row per meaningful event.

| Date | Who | Step | Event | Evidence |
|------|-----|------|-------|----------|
| 2026-08-18 | rzy | B.4 | Contract sweep of 12 order endpoints completed; FB-07 mismatch found and fixed | `docs/evidence/fb-07.txt` |

## Convergence Loop

The loop is what makes the plan self-verifying. It runs in Phase 7, after execution and before the plan
is declared done.

```
round = 1
repeat:
  run the thirteen perspectives against the CURRENT state (plan + code + live behavior)
  merge findings, deduplicate against previously recorded findings
  file each new finding as a checklist item under its owning step
  fix every blocker and major
  record the round in the Convergence Loop Log
  round += 1
until two CONSECUTIVE rounds produce zero new blocker and zero new major findings
```

Rules:

- **Two consecutive clean rounds, not one.** One clean round is as likely to mean the agents asked the
  same questions again as it is to mean the work is sound. The second round must vary its entry points:
  different files first, different call direction, different data.
- **Deduplicate against recorded findings, not against fixed ones.** Deduplicating against the fixed
  list makes rejected-but-real findings reappear forever and the loop never converges.
- **A finding is never closed by re-rating it.** It is closed by a fix, or by a `- [-]` with a named
  human authorizer and a written reason. Anyone may audit those decisions later; that is the point.
- **The loop has a floor, not a ceiling.** Minimum two rounds even if the first is clean. If the loop
  passes six rounds without converging, stop and escalate to the human: the design, not the code, is
  probably wrong.

### Convergence Loop Log

```markdown
| Round | Date | Blockers | Majors | Minors | New steps filed | Outcome |
|-------|------|----------|--------|--------|-----------------|---------|
| 1 | 2026-08-18 | 3 | 7 | 12 | B.7, C.4 | Not clean |
| 2 | 2026-08-19 | 0 | 2 | 5 | C.5 | Not clean |
| 3 | 2026-08-20 | 0 | 0 | 2 | — | Clean (1/2) |
| 4 | 2026-08-21 | 0 | 0 | 1 | — | Clean (2/2) — loop closed |
```

## Required Critical Plan Format

Every critical plan file uses this **exact** structure. All sections mandatory, in order, none renamed,
no extras.

```markdown
# <Plan title>

## Plan Identity                       <!-- [MANDATORY] -->
- **Id:** CP-<slug>
- **Criticality:** <what breaks if this fails>
- **Owner:** <name>
- **Created:** <YYYY-MM-DD> · **Last updated:** <YYYY-MM-DD>
- **Status:** planning | approved | in-execution | converging | done
- **Linear / issue:** <id or `none`>

## Execution Ledger                    <!-- [MANDATORY] live progress; see Living Document Protocol -->
[Phase table + current position + owner + last updated + open blockers + handoff notes]

## Context                             <!-- [MANDATORY] full narrative. No compaction. -->
[What exists today, what triggered this, what is wrong with the current state, what the world looks
like after. Written so someone with no prior exposure can act on it.]

## Criticality Justification           <!-- [MANDATORY] why this is a critical plan, not a normal one -->
[The explicit user request that invoked this skill, quoted · what function is at risk · who is
affected and how many · what failure costs · why it is not recoverable by a follow-up commit.]

## General Objective                   <!-- [MANDATORY] one sentence -->

## Specific Objectives                 <!-- [MANDATORY] each individually verifiable -->
1. …

## Non-Goals                           <!-- [MANDATORY] explicit out of scope; "None." if none -->
- [Thing deliberately excluded]: [why, and what would have to change for it to be included]

## Approach Chosen                     <!-- [MANDATORY] full rationale, not a sentence -->

## Alternatives Considered             <!-- [MANDATORY] at least 2 rejected, each with reason -->

## Architecture Decision Records       <!-- [MANDATORY] one per structural decision -->
### ADR-1 — <decision>
- **Context:** …
- **Decision:** …
- **Consequences:** …
- **Reversibility:** trivial | costly | one-way door
- **Revisit if:** …

## Blast Radius                        <!-- [MANDATORY] -->
| Surface | What breaks if this plan is wrong | Who notices | Detection signal |

## Critical Files                      <!-- [MANDATORY] concrete paths only, zero wildcards -->

## Reusable Assets                     <!-- [MANDATORY] from Reuse Discovery; "none — rationale" if empty -->

## Contract Inventory                  <!-- [MANDATORY] the three registries, complete -->
### Frontend↔Backend Contract Registry
### Database Contract Registry
### Error Code Registry

## Data Integrity Plan                 <!-- [MANDATORY] "No data mutation." if none -->
- **Migrations:** …
- **Backfills:** …
- **Invariants that must hold before and after:** …
- **Snapshot taken:** yes/no · when · where
- **Dry-run dataset:** …

## Phases and Steps                    <!-- [MANDATORY] every step carries ALL TWELVE fields -->
### Phase A — <name>
#### A.1 <step name>
   Skills: …
   Resources: …
   Business decision: …
   Why: …
   Output: …
   Contracts touched: FB-01, DB-03, ERR-02 | none
   Data impact: [rows read / written / migrated, or `none`]
   Blast radius: [what breaks if THIS step is wrong]
   Rollback: [the exact undo, or `irreversible — see ADR-n`]
   Verification: [exact command / assertion for THIS step]
   Acceptance checklist:
   - [ ] …
   - [ ] …
   Status: pending | in-progress | blocked | done · owner · date

## Perspective Audit Matrix            <!-- [MANDATORY] all thirteen; N/A needs a reason -->
| # | Perspective | Round run | Findings (B/M/M/N) | Status |

## Convergence Loop Log                <!-- [MANDATORY] one row per round -->

## End-to-End Verification             <!-- [MANDATORY] integration level, concrete tools -->

## Rollback Plan                       <!-- [MANDATORY] per phase, plus the global abort -->
| Phase | Trigger to roll back | Procedure | Data recoverable? | Who decides |

## Knowledge Gaps                      <!-- [MANDATORY] "None." if none -->

## Execution Log                       <!-- [MANDATORY] appended, never rewritten -->

## Approval Request                    <!-- [MANDATORY] verbatim block -->
This critical plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to
start execution under `how-to-dev`, with the Living Document Protocol and the Convergence Loop in force.
Reply with corrections to revise the plan in place.
```

## Field-by-Field Rigor

Beyond the six fields inherited from `how-to-plan` (which keep their rules unchanged), the six new
fields have their own acceptance bar.

| Field | Acceptable | Rejected |
|-------|------------|----------|
| `Contracts touched` | `FB-03, FB-04, DB-07` — ids that exist in the registries | "the orders endpoints" |
| `Contracts touched` (none) | `none — this step only moves a component file` | (field omitted) |
| `Data impact` | "Writes ~4.200 rows in `inventory_movements`; reads all of `products` for the store" | "some database changes" |
| `Data impact` (none) | `none — read-only step` | (field omitted) |
| `Blast radius` | "If wrong, every POS sale in a restaurant store posts to the wrong PUC account, silently" | "could cause bugs" |
| `Rollback` | "`git revert <sha>`; the migration is additive, no data undo needed" | "revert if needed" |
| `Rollback` (irreversible) | "irreversible — a DIAN consecutive is burned; see ADR-3 for the mitigation" | "can't roll back" |
| `Acceptance checklist` | 4-12 granular `- [ ]` items, each independently tickable and verifiable | One item saying "step done" |
| `Status` | `done · rzy · 2026-08-18` | `done` |

## Critical Plan Validation Checklist

Run before adding the `## Approval Request` block. Any unchecked item blocks approval.

### Structural

- [ ] All 22 mandatory sections exist, in the exact order of `Required Critical Plan Format`.
- [ ] No ad-hoc sections were added.
- [ ] `Criticality Justification` quotes the explicit user request that invoked this skill, and names the risk signals that justify the weight.
- [ ] `Non-Goals` is present (`None.` allowed).
- [ ] At least one ADR exists, with `Reversibility` filled.
- [ ] `Blast Radius` has one row per affected surface, with a detection signal per row.

### Contracts

- [ ] The `FB-*` registry row count equals the endpoint count found in Phase 2.
- [ ] The `DB-*` registry row count equals the database point count found in Phase 2.
- [ ] Every `DB-*` row states its tenant scoping mechanism; every `withoutScope()` has a written reason.
- [ ] Every `DB-*` row states an invariant, or states why there is none.
- [ ] Every failure path introduced by the plan has an `ERR-*` row with an HTTP status and a frontend behavior.
- [ ] No step introduces a `throw new Error()` that can reach a controller.
- [ ] Every registry row has a runnable `Verification`, not a description.

### Per-Step (apply to **every** step)

- [ ] All twelve fields present, in order.
- [ ] `Contracts touched` references ids that exist in the registries, or says `none` with a reason.
- [ ] `Data impact` is quantified, or says `none` with a reason.
- [ ] `Blast radius` names a concrete wrong outcome, not "bugs".
- [ ] `Rollback` is an exact procedure, or declares irreversibility and points at the ADR that accepted it.
- [ ] `Acceptance checklist` has at least 4 granular items.
- [ ] `Status` carries owner and date once it leaves `pending`.
- [ ] `Skills` passes the Skill Selection Matrix of `how-to-plan` (inherited unchanged).

### Data integrity

- [ ] Every row-mutating migration carries a `-- DATA IMPACT:` header.
- [ ] Incoming foreign keys were identified and handled with the safe pattern; no `CASCADE`, no
      `TRUNCATE CASCADE`, no `DROP TABLE`, no unqualified `DELETE` / `UPDATE`.
- [ ] A production snapshot is recorded as taken before any destructive step.
- [ ] The dry-run ran against a representative dataset, not an empty database.

### Audit & convergence

- [ ] All thirteen perspectives appear in the `Perspective Audit Matrix`; every `N/A` has a reason.
- [ ] The `Convergence Loop Log` exists (empty before execution, populated during Phase 7).
- [ ] The exit condition is stated as two consecutive clean rounds.

### Living document

- [ ] `Execution Ledger` exists with the phase table, current position, owner and last-updated date.
- [ ] Every checklist item uses the checkbox vocabulary.
- [ ] `Execution Log` exists (may be empty before execution).

## Anti-Patterns

| Anti-pattern | Correct alternative |
|--------------|---------------------|
| A registry row saying "and the other 20 endpoints follow the same pattern" | 20 more rows. Completeness is the whole point of the registry. |
| Ticking `- [x]` because the code was written | `- [x]` means the `Verification` ran and passed. Attach the evidence. |
| Filling the contract registries after the code was written | Phase 2 precedes design on purpose. A retroactive registry documents what was built, not what should have been. |
| Verifying a contract with `tsc` or a build | A build proves the code agrees with the declared type. Only a live response proves the server agrees. |
| Closing a convergence round by downgrading a `blocker` to `minor` | Fix it, or record a `- [-]` with the human who authorized accepting it. |
| One clean round and calling the loop closed | Two consecutive clean rounds, with varied entry points on the second. |
| Deduplicating findings against the fixed list | Deduplicate against everything seen. Otherwise rejected-but-real findings reappear forever. |
| Executing several steps and updating the plan at the end | The plan is updated as you go. A plan updated in bulk is a plan that was never a handoff artifact. |
| Deleting a resolved blocker line from the ledger | Move it to the `Execution Log` with its resolution. The history is evidence. |
| `withoutScope()` in a `DB-*` row with no justification | Write why the tenant filter is bypassed and what replaces it. Unjustified is a `blocker`. |
| A perspective agent that writes code | Perspectives investigate and report. Fixes become plan steps with the full twelve fields. |
| A perspective agent returning "no issues found" without an attack narrative | Re-run it with an adversarial prompt. A perspective that did not try to break anything did not run. |
| Marking a perspective `N/A` silently | `N/A` needs a written reason, reviewable by the human. |
| Invoking this skill because the work *looks* critical, without the user asking | Explicit invocation only. Name the risk in one sentence, continue under `how-to-plan`, let the human decide. |
| Blocking the work to ask "should this be a critical plan?" | Suggest and keep planning. A question that stops delivery is worse than a plan the human upgrades later. |
| Using this skill for a two-file feature | Use `how-to-plan`. Over-escalation trains people to skim checklists, which is how the next real critical plan fails. |
| A `Blast radius` of "could cause issues" | Name the concrete wrong outcome, who sees it, and how it is detected. |
| Replanning mid-execution because a step "seems suboptimal" | Stop and ask the human. Global rule 1.3 forbids silent replan; here it also invalidates the audit trail. |

## User Interaction Boundary

Identical channels to `how-to-plan`, with two additions specific to critical work.

| Question type | Channel |
|---------------|---------|
| Choose between viable approaches (Phase 3) | `AskUserQuestion` |
| Resolve a requirement ambiguity grep cannot answer (Phase 3) | `AskUserQuestion` |
| Request approval of the finished plan (Phase 6) | `## Approval Request` block |
| Confirm a destructive or irreversible action | Inline confirmation naming the specific irreversible consequence |
| **Accept a finding without fixing it** (Phase 7) | Inline confirmation; record as `- [-]` with the authorizer's name |
| **Escalate a non-converging loop** (6+ rounds) | Inline, stating that the design is suspect, not the code |

## Relationship With Development

Execution runs under `how-to-dev`, with these additional obligations:

- Load every skill in the step's `Skills` before touching it.
- Update `Status`, the step checklist, the `Execution Ledger` and the `Execution Log` **as you go**.
- Never tick a box before its `Verification` has run.
- Run the contract sweep gate before declaring any phase complete.
- Run the convergence loop before declaring the plan complete.
- Preserve every `Business decision` and every ADR. Deviating returns to planning.

**Mandatory gates before a critical plan is "done"** — the `git-workflow` gates (RULES 5-8) apply
unchanged, plus:

- [ ] Every `FB-*`, `DB-*` and `ERR-*` row ticked with evidence.
- [ ] All thirteen perspectives run, with findings resolved or explicitly accepted.
- [ ] Two consecutive clean convergence rounds recorded.
- [ ] `Execution Ledger` shows every phase complete and no open blockers.
- [ ] `pr-code-review` passed the 80% threshold.

If any gate is unmet, the work is **not done**. Reporting it as done is the failure this skill exists to
prevent.

## Related Skills

- `how-to-plan` — The normal planning protocol. This skill inherits its six core step fields, its
  Skill Selection Matrix, and its Verification Mechanisms Catalog unchanged.
- `how-to-dev` — Execution after approval.
- `agent-teams` — Orchestration of the perspective fleet.
- `how-to-test` — Verification methodology: `curl` for API contracts, Playwright MCP for frontend E2E.
- `vendix-error-handling` — The standardized error-code catalog behind Registry 3.
- `vendix-prisma-migrations` — Migration safety rules behind the Data Integrity Plan.
- `vendix-prisma-scopes` / `vendix-multi-tenant-context` — Tenant scoping behind Registry 2.
- `vendix-backend-api` / `vendix-validation` — DTO shape and validation behind Registry 1.
- `pr-code-review` — The 80% gate.
- `vendix-engram` — Persistent memory for decisions surfaced by the plan.
- `skill-creator` — Resolving knowledge gaps found during a critical plan.

## Changelog

- **v1.1** — Invocation restricted to **explicit user request only**. The skill no longer activates by
  inferring criticality: `auto_invoke` triggers now describe what the user says, not what the work looks
  like. Added `Invocation — Explicit Only` (two triggers, complex-is-not-critical table, never-self-
  escalate rule with a suggestion script, signals worth mentioning, downgrading), a Core Rule, two
  anti-pattern rows, and a `Criticality Justification` that must quote the request that invoked it.
- **v1.0** — Initial release. Derived from `how-to-plan` v2.4 and specialized for mission-critical,
  large-scale work. Adds: seven-phase workflow with a dedicated Contract Mapping phase before design;
  twelve mandatory step fields (adds `Contracts touched`, `Data impact`, `Blast radius`, `Rollback`,
  `Acceptance checklist`, `Status`); the three contract registries with completeness-over-sampling as a
  hard rule; the thirteen-perspective audit fleet; the convergence loop with a two-consecutive-clean-
  rounds exit; the Living Document Protocol (checkbox vocabulary, Execution Ledger, Execution Log) for
  mid-execution handoff; ADRs, Non-Goals, Blast Radius, Data Integrity Plan and Rollback Plan sections.

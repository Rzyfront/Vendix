---
name: how-to-plan
description: >
  Defines the Vendix planning protocol before development.
  Trigger: When creating implementation plans, analyzing non-trivial changes, decomposing work, or preparing multi-agent development.
license: MIT
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Creating implementation plans or decomposing non-trivial work"
    - "Planning structural changes, multi-file changes, broad refactors, or new features"
    - "Discovering reusable assets before proposing new code"
    - "Verifying plan completeness before approval"
    - "Choosing between viable architectural approaches"
    - "Declaring MCP servers, CLI commands, or web research alongside skills in a plan"
    - "Running the Plan Validation Checklist before requesting approval"
    - "Selecting the correct skills for each plan step using the Skill Selection Matrix"
    - "Picking concrete verification mechanisms (Bruno, curl, build, audit, log inspection) per step"
---

# How To Plan

## Purpose

Define the planning protocol every Vendix agent must follow before writing code. A valid plan explains **why** the change exists, **what** general and specific outcomes it must achieve, **which skills** govern each step, **which business decisions** apply, **which files** are affected, **which existing assets** are reused, and **how the result is verified end-to-end**.

This skill specifies both the **format** of the plan and the **operational workflow** to produce it (5 explicit phases mirroring the Claude Code Plan Mode).

## Core Rules

- Always plan before non-trivial development. Trivial = single-line fix, typo, or isolated config change under 10 lines (see global rule 2.3).
- **Every Step block must contain ALL SIX mandatory fields**, in this order: `Skills`, `Resources`, `Business decision`, `Why`, `Output`, `Verification`. Missing **any** field invalidates the entire plan — it is not approvable until fixed.
- Every plan step must reference the skills that govern it, or be explicitly marked `Knowledge gap` when no skill exists. Never list `how-to-plan` as a step skill — it governs planning, not execution.
- Every plan step must declare the `Business decision` it enforces (rule, product behavior, or technical policy). This field is **non-negotiable**.
- Every plan step must declare its `Resources` — external tooling beyond skills: MCP servers (`pencil`, `github`, etc.), build / test / migration commands, web searches consulted for official docs, third-party APIs, dashboards, or any non-skill input. **Vague resources are forbidden**: write the exact command (`npm run test -w apps/backend -- --runInBand path/to/spec.ts`), not "backend tests".
- Every plan step must declare its per-step `Verification` (the check that proves *this* step done). E2E verification at plan level does **not** replace per-step verification.
- Every plan must split outcomes into `General Objective` + `Specific Objectives`. Specific objectives must be individually verifiable.
- Compare viable approaches and record the chosen one with rationale.
- Actively search for reusable functions, components, services, and patterns before proposing new code. Document them under `Reusable Assets`.
- `Critical Files` must list **concrete paths** (controller, service, DTO, component). Wildcards (`domain/x/*`) are forbidden — the developer must not have to re-discover scope.
- The plan must contain **only** the sections defined in `Required Plan Format`. Adding ad-hoc sections (e.g. `Assumptions`, `Notes`, `TODO`) is forbidden: fold their content into `Context`, the matching Step's `Business decision`, or `Knowledge Gaps`.
- Use subagents through `agent-teams`. Maximum 3 in parallel per phase. Default = 1.
- Never ask "is this plan ok?" — request approval through the formal mechanism (see User Interaction Boundary).
- Never replan during execution unless the human explicitly requests it (global rule 1.3).
- Before adding the `## Approval Request` block, the planner **must** run the `Plan Validation Checklist` (see below) and only proceed if every box is checked.

## Plan Workflow Phases

Every non-trivial plan flows through five phases. Phases are sequential, not optional.

| Phase | Goal | Tools | Output | Max Agents |
|-------|------|-------|--------|------------|
| **1. Understanding** | Map the request, codebase areas affected, and existing assets to reuse | `Explore` subagent type, `Read`, `grep`, skill lookup | Inventory of files, symbols, skills, and reusable assets | 3 |
| **2. Design** | Generate one or more implementation approaches and compare them | `Plan` subagent type, web search if needed | Candidate approach(es) with trade-offs | 3 |
| **3. Review** | Read the critical files surfaced in Phase 1, validate the chosen approach against reality, clarify ambiguities | `Read`, `AskUserQuestion` | Refined approach + unresolved questions answered | 1 |
| **4. Final Plan** | Write the plan file using the Required Plan Format | `Write` / `Edit` on the plan file only | Complete plan file ready for human review | 0 |
| **5. Approval** | Present the plan and request explicit human confirmation. **Do not execute until approved.** | Formal approval request (see User Interaction Boundary) | "ejecuta" / "apruebo" / "procede" from the human | 0 |

### Phase-specific rules

- **Phase 1** uses `Explore` (read-only search). Use it for "where is X defined", "find references to Y", "list components matching Z". Do not use `Explore` for design.
- **Phase 2** uses `Plan` (architectural design). Brief it with concrete filenames, code path traces, and constraints discovered in Phase 1. A vague Phase 2 prompt produces a vague plan.
- **Phase 3** is the only phase where `AskUserQuestion` is appropriate, and only to (a) choose between viable approaches or (b) resolve a requirement ambiguity that grep cannot answer.
- **Phase 4** edits **only** the plan file. No source code changes.
- **Phase 5** uses the formal approval block in the plan, never an `AskUserQuestion`.

## Agent Strategy

Default delegation strategy when invoking `agent-teams`.

| Task Type | Agent Count | Notes |
|-----------|-------------|-------|
| Isolated change in known files | 1 `Explore` | Same files the user named or that grep finds immediately |
| Bug investigation across one domain | 1 `Explore` | Trace the call path; no design needed yet |
| New feature spanning 2+ domains | 2-3 `Explore` (parallel) | One per domain; merge findings in Phase 1 result |
| Architectural decision (multiple viable approaches) | 1-3 `Plan` (parallel) | Each agent argues a different trade-off: simplicity / performance / maintainability |
| Cross-cutting refactor | 2 `Explore` + 1 `Plan` | Sequential: discover, then design |

### Parallelization rules

- Independent agents → single message with multiple tool calls.
- Dependent agents → sequential; pass each output to the next.
- Hard ceiling: 3 in parallel per phase. Going wider duplicates searches and pollutes context.

### Subagent prompt requirements

Every prompt to a subagent must include:

1. The user's original goal in one sentence.
2. The phase (Understanding / Design) and what the agent owns within it.
3. Concrete filenames, symbols, or code path traces already known.
4. Explicit constraints (skills the work must respect, anti-patterns to avoid).
5. The expected output shape (list of files, comparison table, decision matrix).
6. Whether the agent should **investigate** (read-only) or **write code** — never assume.

A vague prompt ("look at the codebase and tell me what to do") wastes the agent slot.

## Resources Beyond Skills

Skills capture repeatable Vendix patterns, but a plan rarely succeeds with skills alone. Each step must also declare the **external resources** it depends on. A plan that only lists skills is incomplete.

| Resource type | Examples | When to declare |
|---------------|----------|-----------------|
| **MCP servers** | `pencil` (design files), `github` (PRs/issues), Linear, Atlassian, Notion, HubSpot | The step reads or writes data outside the repo file tree |
| **CLI commands** | `npx prisma migrate dev`, `./skills/setup.sh --sync`, build / test commands | The step requires a specific shell invocation, including idempotent migrations |
| **Web research** | Official docs URLs, RFCs, vendor changelogs | The step depends on third-party behavior, library specifics, or industry standards (global rule 3.4) |
| **External APIs / dashboards** | Wompi sandbox, DIAN endpoints, AWS console, Grafana boards | The step integrates with or observes an external system |
| **Files outside source** | `.bru` collections, `.pen` design files, fixtures, seeds | The step uses non-source artifacts as input |

### Rules

- Always pair skills with resources in each step. `Skills: vendix-prisma-migrations` + `Resources: npx prisma migrate dev --name <slug>` is complete; just the skill is not.
- Web research is part of planning, not improvisation. If the step needs vendor docs, link them upfront in `Resources`, not mid-execution.
- If the plan reveals that a skill is outdated relative to a fresh web source, mark a `Knowledge Gap` to update the skill via `skill-creator`.
- Resources are **descriptive**, not authorizations. Destructive actions (migrations on prod, deletions, force pushes) still require explicit human confirmation regardless of being listed.

## Reuse Discovery (mandatory Phase 1 checklist)

Before any step proposes new code, the planner must complete this checklist:

- [ ] Grep for related symbols, types, services (`grep -rn "ConceptName" apps/`).
- [ ] Read the SKILL.md of every domain affected (use the Auto-invoke tables in AGENTS.md / CLAUDE.md as a map).
- [ ] Scan shared frontend assets: `apps/frontend/src/app/shared/` (components, services, pipes, directives).
- [ ] Scan shared backend assets: `apps/backend/src/common/` (services, decorators, guards, interceptors, DTOs).
- [ ] Check `libs/` for cross-app primitives.
- [ ] List the assets found under `Reusable Assets` in the plan, with their paths. If nothing is reusable, state so explicitly.

Skipping this checklist causes duplication (a second `CurrencyFormatService`, a parallel modal wrapper, a redundant guard). Duplication is a planning failure, not a coding failure.

## Required Plan Format

Every plan file must use this **exact** structure. Sections are ordered, all are mandatory, none may be omitted, renamed, or supplemented with extras.

```markdown
## Context                            <!-- [MANDATORY] 2-5 sentences. Why this change exists. -->
[Problem it solves, what triggered it, expected outcome.]

## General Objective                  <!-- [MANDATORY] one sentence, human-facing outcome. -->
[Single sentence.]

## Specific Objectives                <!-- [MANDATORY] N items, each individually verifiable. -->
1. [Measurable sub-result 1]
2. [Measurable sub-result 2]
3. [...]

## Approach Chosen                    <!-- [MANDATORY] selected approach + why it beats alternatives. -->
[Selected approach and why it beats the alternatives.]

## Alternatives Considered            <!-- [MANDATORY] at least 1 rejected alternative with reason. -->
- [Alternative]: [why it was not chosen]

## Critical Files                     <!-- [MANDATORY] concrete paths only. Wildcards forbidden. -->
- `apps/backend/src/domains/x/y.controller.ts` — [role in the change]
- `apps/frontend/src/app/.../z.component.ts` — [role in the change]

## Reusable Assets                    <!-- [MANDATORY] from Reuse Discovery. State "none — rationale" if empty. -->
- `path/to/asset.ts` — [what it provides, why it fits]

## Steps                              <!-- [MANDATORY] each step has ALL SIX FIELDS below. -->
1. [Step name]
   Skills: [skill-1], [skill-2]                                  <!-- [MANDATORY] never `how-to-plan` itself -->
   Resources: [exact CLI command | MCP tool | doc URL | `none`]  <!-- [MANDATORY] no vague phrases -->
   Business decision: [rule, product behavior, or technical policy being applied]  <!-- [MANDATORY] -->
   Why: [reason this step exists AND why in this position relative to others]      <!-- [MANDATORY] -->
   Output: [concrete artifact or behavior produced]              <!-- [MANDATORY] -->
   Verification: [exact check for THIS step — command, file diff, UI assertion]  <!-- [MANDATORY] -->

## End-to-End Verification            <!-- [MANDATORY] integration-level, with concrete tools. -->
1. [Integration check covering multiple steps + tool used: Bruno collection, curl, UI flow, etc.]
2. [User-facing or contract-level check + how it is observed]
3. [Build / typecheck / test command — exact invocation]

## Knowledge Gaps                     <!-- [MANDATORY] write "None." if there are none. -->
- [Gap]: [missing skill or skill update proposed, with rationale]

## Approval Request                   <!-- [MANDATORY] verbatim block below. -->
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
```

### Field-by-Field Rigor

Each row defines what counts as **acceptable** vs **rejected**. If a field falls in the rejected column, the plan is not approvable.

| Field | Acceptable | Rejected |
|-------|------------|----------|
| `Context` | "ORG_ADMIN cannot supervise fiscal data; reports query store endpoints causing 403. Goal: read-only org views respecting `fiscal_scope`." | "Need to fix fiscal stuff." |
| `General Objective` | "ORG_ADMIN supervises invoicing, accounting and payroll across stores respecting `fiscal_scope`." | "Improve org panel." |
| `Specific Objectives` | "Invoicing list returns data from `/organization/invoicing/invoices` with `store_id` optional when `fiscal_scope=ORGANIZATION`." | "Better invoicing." |
| `Critical Files` | `apps/backend/src/domains/organization/invoicing/invoicing.controller.ts` | `organization/invoicing/*` (wildcard) |
| `Reusable Assets` | `apps/backend/src/common/services/fiscal-scope.service.ts — resolves fiscal_scope + entity` | "There are some services we can reuse." |
| Step `Skills` | `vendix-fiscal-scope, vendix-backend-api, vendix-prisma-scopes, vendix-permissions` | `how-to-plan, vendix-backend` (the first is a planner skill, second is too generic when API is involved) |
| Step `Resources` | `npm run test -w apps/backend -- --runInBand src/domains/organization/invoicing/invoicing.controller.spec.ts` | "Backend unit tests." |
| Step `Business decision` | "ORG_ADMIN supervises invoicing read-only; no DIAN submission from org panel because `fiscal_scope` may target store NIT." | "We want it to work right." |
| Step `Why` | "Goes first because frontend in step 4 depends on these endpoints existing." | (missing entirely) |
| Step `Output` | "GET `/organization/invoicing/invoices?store_id=?&from=&to=` returning paginated invoices scoped by `accounting_entity_id`." | "Endpoints for invoicing." |
| Step `Verification` | "`curl -H 'Authorization: Bearer $ORG_TOKEN' /organization/invoicing/invoices` returns 200 with `data[]` non-empty; same call without org token returns 403." | "It should work." |
| `End-to-End Verification` | "Bruno collection `orgs/fiscal-supervision.bru` runs green; `npm run build:prod -w apps/frontend` exits 0." | "Test everything." |
| `Knowledge Gaps` | "Cross-module fiscal supervision pattern not covered — propose new skill `vendix-fiscal-supervision` after impl stabilizes." | (absent — must say "None." if there are none) |

### Verification mechanisms catalog

When writing `Verification` and `End-to-End Verification`, pick from this catalog. Use exact tool invocations, never generic phrases.

| Mechanism | When | Example |
|-----------|------|---------|
| Bruno (`.bru`) | API contract & auth boundaries | `bruno run apps/api-tests/orgs/fiscal-supervision.bru --env dev` |
| `curl` | One-off endpoint sanity | `curl -H 'Authorization: Bearer $TOK' http://localhost:3000/organization/invoicing/invoices` |
| Backend unit test | Service logic | `npm run test -w apps/backend -- --runInBand src/domains/organization/invoicing/invoicing.service.spec.ts` |
| Frontend build | Type safety after refactor | `npm run build:prod -w apps/frontend` |
| Zoneless audit | Signal-based components | `npm run zoneless:audit` |
| Migration verification | DB schema change | `npx prisma migrate status` + targeted SQL `SELECT` |
| Permission verification | RBAC change | Bruno test using a token whose role lacks the permission must return 403 |
| Manual UI check | Behavior not covered by build | Document the exact route + steps + expected state |
| Log inspection | Async flow / queue | `docker logs --tail 200 vendix-backend | grep <correlation_id>` |

## Plan Validation Checklist

Before adding the `## Approval Request` block, the planner must mentally (or literally) check **every** item below. Any unchecked item blocks approval and must be fixed in place.

### Structural

- [ ] All 11 mandatory top-level sections exist in this exact order: `Context`, `General Objective`, `Specific Objectives`, `Approach Chosen`, `Alternatives Considered`, `Critical Files`, `Reusable Assets`, `Steps`, `End-to-End Verification`, `Knowledge Gaps`, `Approval Request`.
- [ ] No ad-hoc sections were added (`Assumptions`, `Notes`, `TODO`, `Risks`, etc.). If such content matters, it was folded into `Context` or a Step's `Business decision`.
- [ ] `Specific Objectives` has at least 1 entry; each is independently verifiable (no "Improve X").
- [ ] `Alternatives Considered` lists at least 1 rejected alternative with reason.

### Per-Step (apply to **every** step in `Steps`)

- [ ] `Skills:` listed, none is `how-to-plan`, no obvious skill is missing (run Skill Selection Matrix below).
- [ ] `Resources:` is an exact command / URL / MCP tool / or the literal word `none`. No vague phrases ("run tests").
- [ ] `Business decision:` present, names a concrete rule, product behavior, or technical policy (not a wish like "must work well").
- [ ] `Why:` present, explains why the step exists **and** why it sits at this position in the sequence.
- [ ] `Output:` describes a concrete artifact, endpoint shape, file, or behavior — not a hand-wave.
- [ ] `Verification:` is an exact check picked from the Verification Mechanisms Catalog, scoped to **this** step (not the whole plan).

### Files & assets

- [ ] `Critical Files` lists concrete paths only — zero wildcards, zero "folder X".
- [ ] Every step's expected file edits map to entries in `Critical Files` (or are added there).
- [ ] `Reusable Assets` was populated from a real Reuse Discovery pass; if empty, the rationale is stated.

### Verification

- [ ] `End-to-End Verification` covers integration paths, not single-step checks (those live in each Step).
- [ ] Every E2E item names a concrete tool / command (Bruno, curl, build command, log inspection).
- [ ] `Knowledge Gaps` is present and explicit — `None.` is allowed; absence is not.

### Skill Selection Matrix (use to catch missed skills before approving)

Run this matrix against every step. If the trigger applies, the skill **must** appear in that step's `Skills`.

| If the step touches… | Skill that must be in `Skills:` |
|----------------------|---------------------------------|
| Multi-tenant data access (org / store scope) | `vendix-multi-tenant-context`, `vendix-prisma-scopes` |
| Backend authorization, roles, RBAC | `vendix-permissions`, `vendix-backend-auth` |
| Org vs Store behavior (operating mode) | `vendix-operating-scope` |
| Fiscal entity / DIAN / NIT logic | `vendix-fiscal-scope` |
| API endpoint creation / DTO shape | `vendix-backend-api`, `vendix-validation` |
| Frontend module / form / component | `vendix-frontend`, `vendix-zoneless-signals`, `vendix-angular-forms` |
| Money / pricing display | `vendix-currency-formatting`, `vendix-product-pricing` |
| Migrations | `vendix-prisma-migrations`, `vendix-prisma-schema` |
| Seeds | `vendix-prisma-seed` |
| Auto journal entries | `vendix-auto-entries`, `vendix-accounting-rules` |
| Inventory stock | `vendix-inventory-stock`, `vendix-inventory-valuation` |
| Subscription gating | `vendix-subscription-gate` (only if write or AI feature; read-only does **not** need it) |
| AI features | `vendix-ai-engine`, `vendix-ai-agent-tools`, `vendix-ai-platform-core` |
| Notifications | `vendix-notifications-system` |
| Dates / timezones | `vendix-date-timezone` |
| File uploads / S3 | `vendix-s3-storage` |

If the matrix is silent on a domain the step touches, raise it as a `Knowledge gap`.

## Anti-Patterns

The following are prohibited. Each row lists the wrong move and its correct alternative.

| Anti-pattern | Correct alternative |
|--------------|---------------------|
| Step missing `Why` or `Verification` | All six fields are mandatory: `Skills`, `Resources`, `Business decision`, `Why`, `Output`, `Verification`. No exceptions. |
| Wildcards in `Critical Files` (`domain/x/*`) | List concrete paths: `apps/.../x.controller.ts`, `apps/.../x.service.ts`, `apps/.../x.dto.ts`. |
| Vague `Resources` ("backend tests") | Exact command: `npm run test -w apps/backend -- --runInBand <spec>`. Or `none`. |
| Listing `how-to-plan` as a step skill | `how-to-plan` governs the planner, not the executor. Use the domain skills the step actually invokes. |
| Adding non-spec sections (`Assumptions`, `Notes`, `Risks`, `TODO`) | Fold into `Context`, the step's `Business decision`, or `Knowledge Gaps`. The plan format is closed. |
| `Knowledge Gaps` section absent because there are none | Write `None.` explicitly. Section absence is a format break. |
| E2E `Verification` items like "Test everything" | Each item names a concrete tool: Bruno collection, curl, build command, manual UI route + expected state. |
| Including `vendix-subscription-gate` in read-only steps | Subscription gate applies to **write** operations or AI features. Pure read-only views do not gate. |
| Missing `vendix-multi-tenant-context` on any step that resolves org/store from JWT | Always include it where AsyncLocalStorage tenant resolution matters. |
| Asking "¿está bien el plan?" / "¿procedo?" mid-text | Use the formal `## Approval Request` block at the end of the plan |
| Using `AskUserQuestion` to validate a finished plan | `AskUserQuestion` is for Phase 3 only (choose approach / clarify requirement). Approval uses the formal block. |
| Replanning during execution because a step "seems suboptimal" | Stop, ask the human explicitly. Global rule 1.3 forbids silent replan. |
| Proposing new code without running the Reuse Discovery checklist | Run the checklist first. Document the result. |
| Writing a plan without `Business decision` per step | Every step has it. If unknown, mark `Knowledge gap`. |
| Launching 4+ parallel subagents to "be thorough" | Hard cap at 3 per phase. Default 1. |
| Skipping Phase 3 to write the plan faster | Phase 3 is where assumptions die. Skipping it produces plans that need replanning. |
| Editing source files while in Phase 4 (Final Plan) | Phase 4 edits only the plan file. Source edits start after Approval. |
| Vague subagent prompts ("look around and suggest stuff") | Include filenames, constraints, output shape, and investigate-vs-write directive. |

## User Interaction Boundary

`AskUserQuestion` and approval are **different channels**. Confusing them is the most common planning failure.

| Question Type | Tool | Example |
|---------------|------|---------|
| Choose between viable architectural approaches | `AskUserQuestion` | "¿Wompi recurrent o pagos manuales para este flujo? Cada uno tiene trade-offs distintos." |
| Resolve requirement ambiguity grep cannot answer | `AskUserQuestion` | "¿La sesión de caja debe cerrarse automáticamente a las 24h o requiere acción explícita?" |
| Request approval of the finished plan | `## Approval Request` block | (User replies "ejecuta") |
| Confirm a destructive action (migration, data delete) | Inline confirmation in chat referencing the specific risk | "Esta migración elimina filas de X. ¿Confirmas?" |

Correct uses:

- ✅ Phase 3, two viable patterns found → `AskUserQuestion` choosing between them.
- ✅ Plan written, ready for review → end the plan with `## Approval Request` and stop.

Incorrect uses:

- ❌ Plan written → `AskUserQuestion` asking "¿está bien?". Use the approval block instead.
- ❌ Phase 1 → `AskUserQuestion` asking "¿qué archivos miro?". Use `Explore` + grep.

## Multi-Agent Analysis (perspective matrix)

When Phase 2 uses multiple `Plan` agents, assign each a distinct perspective so their outputs do not collapse into the same proposal.

| Perspective | Owns |
|-------------|------|
| Domain analysis | Business rules, permissions, tenant scope, data ownership |
| Implementation analysis | Files, dependencies, ordering, risk |
| Verification analysis | Logs, tests, build checks, edge cases |
| UX / API analysis | User-facing behavior, contracts, states, errors |

For broad work, route through `agent-teams`. If agent tooling is unavailable, document the limitation and run separate named analysis passes — never pretend multi-agent review happened.

## Knowledge Gaps

A knowledge gap exists when a planned step requires a repeatable pattern that no existing skill covers.

When a gap appears:

1. Mark the step as `Knowledge gap` instead of inventing rules.
2. Describe the missing pattern and why it matters.
3. Propose the new skill name (or the existing skill to update).
4. Ask the human whether to create or update the skill via `skill-creator`.

## Relationship With Development

After the `## Approval Request` is satisfied, execution moves to `how-to-dev`. The developer agent must:

- Load every skill listed under `Skills:` in each step before touching that step.
- Preserve every recorded `Business decision`. Deviating from one requires returning to planning, not silent override.
- Treat `Critical Files` and `Reusable Assets` as the starting map — extend it only with discoveries, never replace it.
- Run the `End-to-End Verification` block before reporting completion.
- Never replan unless the human explicitly requests it.

## Related Skills

- `how-to-dev` — Development execution after planning.
- `agent-teams` — Subagent orchestration for Phase 1 and Phase 2.
- `skill-creator` — Resolving knowledge gaps by creating or updating skills.
- `skill-sync` — Synchronizing skill metadata to AGENTS.md / CLAUDE.md after changes.
- `vendix-core` — Map of skills by domain for Reuse Discovery.
- `buildcheck-dev` — Verification of build / runtime after execution.

## Changelog

- **v2.1** — Hardening pass for 100% format compliance. Added: explicit "six mandatory fields per step" rule, `Plan Validation Checklist` (structural / per-step / files / verification + Skill Selection Matrix), `Field-by-Field Rigor` table with acceptable-vs-rejected examples, `Verification Mechanisms Catalog` (Bruno, curl, build, audit, log inspection). Annotated `Required Plan Format` template with `[MANDATORY]` inline markers. Anti-Patterns extended with: missing `Why`/`Verification`, wildcards in `Critical Files`, vague `Resources`, `how-to-plan` listed as step skill, non-spec sections (`Assumptions`/`Notes`/`Risks`), absent `Knowledge Gaps`, subscription-gate misapplied to read-only steps, missing `vendix-multi-tenant-context` on tenant-scoped steps.
- **v2.0** — Major rewrite. Added 5-phase workflow (Understanding / Design / Review / Final Plan / Approval), Agent Strategy with parallel cap of 3, Reuse Discovery checklist, Anti-Patterns table, User Interaction Boundary, Resources Beyond Skills section. Format extended with `Context`, `General Objective` + `Specific Objectives` (replaces singular `Objective`), `Critical Files`, `Reusable Assets`, `End-to-End Verification`, `Approval Request`, and `Resources:` field per step (MCPs, CLI commands, web research, external APIs). **Preserved:** `Business decision` per step, `Skills` per step, `Knowledge Gaps`, multi-agent perspective matrix.
- **v1.0** — Initial release. Defined skills-per-step + business-decision-per-step format with single `Objective`.

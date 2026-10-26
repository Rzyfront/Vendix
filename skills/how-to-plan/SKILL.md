---
name: how-to-plan
description: >
  Vendix planning protocol for large work: the ODD feature doc odd/tasks/<feature>.md (Specs/Tasks/Log) approved by Rafael before execution.
  Trigger: /how-to-plan, an explicit plan request, or work that fails the resumption test.
disable-model-invocation: true
license: MIT
metadata:
  author: rzyfront
  version: "3.0"
  scope: [root]
---

# How To Plan

## Purpose

Decide **whether** a change needs a plan and, when it does, write it as an **ODD feature document**
that Rafael approves before execution. A good plan says why the change exists, which business rules
it enforces, which files it touches, what it reuses, and how each task is verified.

## Small vs Large — the Resumption Test

Size is **not** measured in lines or files. Ask: *could another agent resume this work with only the
original request plus `git diff`?*

| Answer | Class | What to do |
|--------|-------|------------|
| Yes | **Small** | Work inline. No plan, no feature doc, no subagents. Verify with the scoped test/log check and report. |
| No | **Large** | Write `odd/tasks/<feature>.md`, present it, and wait for Rafael's approval before touching code. |

Also write a feature doc when Rafael explicitly asks for a plan, even if the work looks small.

Never escalate to `how-to-critical-plan` on your own judgment. If you see critical risk (money, DIAN,
inventory valuation, payroll, auth, tenant scope, row-mutating migration), name it in one or two
sentences, offer the upgrade, and continue with this skill.

## Plan State Rules

| Situation | Action |
|-----------|--------|
| Approved feature doc + Rafael says "ejecuta" / "apruebo" / "procede" | Execute it **as written**, in order. Do not replan. |
| Feature doc exists + plan mode | Review/refine the doc only. No code. |
| Large work, no feature doc | Write the doc first, then ask for approval. |
| Error during execution | Fix it inside the plan's context and record it in `## Log`. Do not rewrite the plan. |
| A task turns out wrong or a `Business decision` must change | Stop and ask Rafael. Replan only when he asks. |

## The Feature Document

Path: `odd/tasks/<feature>.md` (kebab-case slug, e.g. `odd/tasks/org-fiscal-supervision.md`).
It has exactly three sections. It is a living document: tick tasks and append to the log as you go,
so anyone can resume from the file alone.

```markdown
# <Feature title>

## Specs
**Context:** 2-5 sentences — problem, trigger, expected outcome.
**Objective:** one human-facing sentence + verifiable sub-results.
**Business decisions:** each rule / product behavior / technical policy this change enforces.
**Approach:** chosen approach and why; at least one rejected alternative with reason.
**Critical files:** concrete paths only (no wildcards), each with its role.
**Reusable assets:** paths found in Reuse Discovery, or "none — <rationale>".
**Verification (end-to-end):** exact commands / flows that prove the whole feature.
**Knowledge gaps:** missing or outdated skills, or "None."

## Tasks
- [ ] T1 — <name> · Skills: <skill-a>, <skill-b> · Files: <paths> · Verify: <exact command>
- [ ] T2 — ...

## Log
- YYYY-MM-DD — Plan written; awaiting Rafael's approval.
- YYYY-MM-DD — Approved by Rafael.
- YYYY-MM-DD — T1 done: <evidence: test output, curl status, commit sha>.
```

### What makes Specs and Tasks good

| Field | Acceptable | Rejected |
|-------|------------|----------|
| Context | "ORG_ADMIN cannot supervise fiscal data; reports hit store endpoints → 403." | "Fix fiscal stuff." |
| Objective | "ORG_ADMIN reads invoices across stores respecting `fiscal_scope`." | "Improve org panel." |
| Business decision | "Org panel is read-only for invoicing; no DIAN submission because `fiscal_scope` may target the store NIT." | "It must work well." |
| Critical files | `apps/backend/src/domains/organization/invoicing/invoicing.controller.ts` | `organization/invoicing/*` |
| Reusable assets | `apps/backend/src/common/services/fiscal-scope.service.ts` — resolves fiscal entity | "Some services can be reused." |
| Task Skills | `vendix-fiscal-scope, vendix-backend, vendix-prisma-scopes, vendix-permissions` | `how-to-plan` (planner skill, never a task skill) |
| Task Verify | `curl -H "Authorization: Bearer $ORG_TOKEN" https://api.vendix.com/api/organization/invoicing/invoices` → 200, `data[]` non-empty; store token → 403 | "Test it." |

Rules:

- Every task names its skills (or `Knowledge gap`) and an **exact** verification command.
- Destructive steps (migrations with data mutation, deletions) still need explicit confirmation at
  execution time even if the doc lists them — see `vendix-prisma-migrations`.
- Keep the doc lean: no `Assumptions` / `Notes` / `Risks` sections — fold them into Specs.
- Never ask "¿está bien el plan?" mid-text; present the doc and wait for an explicit approval word.

## Reuse Discovery (before proposing new code)

- [ ] Grep for related symbols, types and services (`grep -rn "ConceptName" apps/`).
- [ ] Read the SKILL.md of every affected domain (see the skills list in `AGENTS.md` / `skills/`).
- [ ] Scan `apps/frontend/src/app/shared/` (components, services, pipes, directives).
- [ ] Scan `apps/backend/src/common/` (services, decorators, guards, interceptors, DTOs).
- [ ] Check `libs/` for cross-app primitives.
- [ ] Mobile work → load `mobile-dev` and restrict edits to `apps/mobile/`.

Record findings under **Reusable assets**. Duplication (a second `CurrencyFormatService`, a parallel
modal wrapper) is a planning failure.

## Skill Selection Matrix

If a task touches the left column, the right column must be in its `Skills`.

| Task touches… | Skills |
|---------------|--------|
| Multi-tenant data (org / store scope) | `vendix-multi-tenant-context`, `vendix-prisma-scopes` |
| Authorization, roles, RBAC | `vendix-permissions`, `vendix-backend-auth` |
| Org vs Store behavior | `vendix-operating-scope` |
| Fiscal entity / DIAN / NIT | `vendix-fiscal-scope` |
| API endpoint / DTO | `vendix-backend`, `vendix-validation` |
| Frontend module / form / component | `vendix-frontend`, `vendix-zoneless-signals`, `vendix-angular-forms` |
| Mobile (`apps/mobile`) | `mobile-dev` |
| Money / pricing display | `vendix-currency-formatting`, `vendix-product-pricing` |
| Schema / migrations | `vendix-prisma`, `vendix-prisma-migrations` |
| Seeds | `vendix-prisma-seed` |
| Auto journal entries | `vendix-auto-entries`, `vendix-accounting-rules` |
| Inventory stock | `vendix-inventory-stock`, `vendix-inventory-valuation` |
| Subscription gating (writes or AI only, not read-only) | `vendix-subscription-gate` |
| AI features | `vendix-ai-engine`, `vendix-ai-agent-tools`, `vendix-ai-platform-core` |
| Notifications | `vendix-notifications-system` |
| Dates / timezones | `vendix-date-timezone` |
| File uploads / S3 | `vendix-s3-storage` |

If the matrix is silent on a domain the task touches, list it under **Knowledge gaps**.

## Verification Catalog

Pick exact invocations; never generic phrases.

| Mechanism | When | Example |
|-----------|------|---------|
| `curl` (primary API check) | API contract, auth boundary | `curl -sk -H "Authorization: Bearer $TOK" https://api.vendix.com/api/store/orders` |
| Playwright MCP | User-facing frontend flow on the real vhost (`https://vendix.com`, never `localhost:4200`) | `browser_navigate` → `browser_snapshot` (see `how-to-test`) |
| Backend spec (scoped) | Service logic | `npm run buildcheck:test -- src/domains/x/x.service.spec.ts` or `npm run test:path -w apps/backend -- src/domains/x` — one path per call, never the full suite (see `buildcheck-dev`) |
| Frontend health | Template/type errors at runtime | `bash scripts/buildcheck.sh --watch` → last cycle OK. No local build: CI builds |
| Backend health | Runtime errors | `docker logs --tail 40 vendix_backend` |
| Migration | Schema change | `npx prisma migrate status` + targeted `SELECT` |
| Permission | RBAC change | token lacking the permission → 403 |
| Log inspection | Async flow / queue | `docker logs --tail 200 vendix_backend \| grep <correlation_id>` |

Dev credentials: seed owner accounts (`owner@techsolutions.co` / `owner@fashionretail.com`, password
`1125634q`, see `apps/backend/prisma/seeds/users.seed.ts`) or ask the user. Agents never run Bruno
(`.bru`) tests as verification; `vendix-bruno-test` is opt-in for humans.

## Delegation — Only With a Named Reason

Default is to do the work yourself, inline. Spawn subagents only for one of these reasons, and say
which one:

1. **Large exploration** — mapping many files/domains whose dumps would flood your context.
2. **Independent parallel writers** — units with disjoint files and no ordering dependency
   (rules in `parallel`).
3. **Exhausted context** — handing off a well-defined remainder with the feature doc as the brief.
4. **High-risk verifier** — an unanchored second read of money, fiscal, auth or migration changes.

Each subagent prompt states: the goal in one sentence, investigate vs write, concrete files and
constraints, skills to load, and expected output shape. Never "always delegate"; never an
orchestrator that does not code.

Worktrees are allowed (RDD uses them) unless Rafael says otherwise for a task. `git stash` is
forbidden when other changes or agents share the tree — compare against `git show HEAD:<path>`.

## User Interaction

| Need | Channel |
|------|---------|
| Choose between viable approaches; requirement ambiguity grep cannot answer | `AskUserQuestion` while drafting Specs |
| Approval of the feature doc | Present the doc; wait for "ejecuta" / "apruebo" / "procede" |
| Destructive action (migration with data mutation, delete) | Inline confirmation naming the risk |

## Anti-Patterns

| Wrong | Right |
|-------|-------|
| Writing a plan for small work | Pass the resumption test → work inline |
| Deciding "small" by line count | Use the resumption test |
| Coding a large change before Rafael approves the doc | Doc first, approval, then execute |
| Replanning mid-execution because a step "seems suboptimal" | Fix within the plan, log it; replan only on request |
| Wildcards in Critical files | Concrete paths |
| "Run tests" as verification | Exact scoped command |
| Spawning subagents "to be thorough" | Delegate only with a named reason |
| `vendix-subscription-gate` on read-only tasks | Gate applies to writes and AI features only |
| Self-escalating to `how-to-critical-plan` | Name the risk, offer, continue |

## Closing the Work

- Tick every task and append evidence to `## Log` as you go.
- Commit locally per unit of work (allowed); push / PR / merge only when Rafael asks — base is
  `origin/develop` (`git-workflow`).
- When a PR is requested, it passes the `pr-code-review` ≥ 80% gate with at most 2 correction rounds
  (`git-workflow` RULE 8).
- Durable decisions and gotchas go to Engram (`vendix-engram`).

## Related Skills

- `how-to-critical-plan` — explicit-invocation-only protocol for work that cannot fail.
- `parallel` — rules for independent parallel writers.
- `git-workflow` · `pr-code-review` — commits, PR gate.
- `buildcheck-dev` · `how-to-test` — scoped test runner, runtime verification.
- `vendix-engram` — persisting decisions.
- `purge-plans` — cleaning finished plans and feature docs.

## Changelog

- **v3.0** — Adopted ODD: resumption test instead of line thresholds; plan = feature doc
  `odd/tasks/<feature>.md` (Specs/Tasks/Log) approved by Rafael; delegation only with a named
  reason; worktrees allowed; `git stash` forbidden in shared trees; manual-invocation only. Removed
  the 11-section format, six mandatory step fields and the 5-phase subagent workflow. History of
  v1.0–v2.5 is in git.

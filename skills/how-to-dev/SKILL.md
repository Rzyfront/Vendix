---
name: how-to-dev
description: >
  Establishes development best practices using the Vendix skills system.
  Trigger: ALWAYS when the user requests code changes, feature work, fixes, refactors, or development execution.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Code changes, feature work, fixes, refactors, or development execution"
    - "General Development"
---

# How To Dev

## Purpose

Use this skill to execute development work safely and consistently after the required skills and plan are known. This skill defines how to develop; planning rules live in `how-to-plan`.

## Core Rules

- Load every relevant skill before editing code.
- **Mobile detection:** If the task involves `apps/mobile/`, load `mobile-dev` first — all edits are exclusive to `apps/mobile/`; other projects are read-only reference.
- **Git workflow gates (load `git-workflow` before any branch/commit/push):**
  - Work only on a branch that is up to date with `origin/dev` (RULE 5).
  - Pull the latest Engram memories before starting work (RULE 6).
  - Save a new Engram memory before pushing non-trivial changes (RULE 7).
  - Every PR must pass the `pr-code-review` skill at >= 80% before merge (RULE 8).
- Follow the approved plan when one exists; do not replan unless the human asks.
- If no approved plan exists for non-trivial work, use `how-to-plan` before development.
- Keep changes minimal, scoped, and aligned with the mapped skills.
- Do not introduce new architecture, business behavior, or compatibility layers unless the plan or the human explicitly requires it.
- Preserve unrelated user changes in the working tree.
- Verify the result with `buildcheck-dev` before claiming completion.

## Skill-First Development

Before changing files:

1. Identify the affected domain, layer, and file types.
2. If the affected path is `apps/mobile/`, load `mobile-dev` — all edits are restricted to that directory.
3. Load the matching skills from `AGENTS.md` or provider-specific skill routing.
4. Apply the rules from those skills during implementation.
5. If no skill covers a required pattern, mark it as a knowledge gap and ask whether to create or update a skill.

## Execution Discipline

During implementation:

- Make the smallest correct change that satisfies the approved scope.
- Prefer existing project patterns over new abstractions.
- Keep business decisions explicit in code names, validations, tests, or comments when needed.
- Do not silently change behavior outside the planned scope.
- Do not edit migrations, schema, auth, billing, accounting, subscriptions, inventory, AI, or tenant-scoped logic without loading the matching specialized skills.

## Quality Principles

- Read existing code before changing it.
- Match established naming, folder structure, and domain boundaries.
- Keep TypeScript strongly typed; avoid `any` unless an existing integration forces it and the reason is clear.
- Consider tenant isolation and authorization on backend changes.
- Prefer clear existing service/facade/component patterns over speculative abstractions.
- Add comments only when the code path is not self-explanatory.

## Relationship With Planning

Use `how-to-plan` when the work needs a plan, including structural changes, multi-file changes, multi-domain work, broad refactors, new features, or any request where the why and sequence are not already explicit.

Development may proceed directly only for trivial, low-risk edits where the relevant skills are clear and no planning decision is needed.

## Verification

After code or skill changes:

- Use `buildcheck-dev` for development verification.
- **Runtime API/endpoint verification uses `curl`, never Bruno.** Authenticate against dev with a seed owner account (`owner@techsolutions.co` or `owner@fashionretail.com`, password `1125634q`; see `apps/backend/prisma/seeds/users.seed.ts`), or ask the user for the `slug`, `email`, and `password` of an authorized dev test account. Bruno (`.bru`) is opt-in only when a developer explicitly requests it (`vendix-bruno-test`).
- Use `skill-sync` after creating or modifying skills.
- Run production build commands only when the human explicitly requests production verification.

## Related Skills

- `how-to-plan` - Planning protocol before development
- `git-workflow` - **Required** for branches, commits, pushes, PRs, Engram memory sync, and the PR review gate (RULES 1-8)
- `vendix-engram` - Persistent shared memory (load alongside `git-workflow` to satisfy RULES 6-7)
- `pr-code-review` - Automated code review gate (load before any PR merge, RULE 8)
- `agent-teams` - Multi-agent orchestration for non-trivial work
- `buildcheck-dev` - Development verification through Docker watch-mode logs
- `skill-sync` - Synchronize skill metadata and generated agent files

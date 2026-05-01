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
- Follow the approved plan when one exists; do not replan unless the human asks.
- If no approved plan exists for non-trivial work, use `how-to-plan` before development.
- Keep changes minimal, scoped, and aligned with the mapped skills.
- Do not introduce new architecture, business behavior, or compatibility layers unless the plan or the human explicitly requires it.
- Preserve unrelated user changes in the working tree.
- Verify the result with `buildcheck-dev` before claiming completion.

## Skill-First Development

Before changing files:

1. Identify the affected domain, layer, and file types.
2. Load the matching skills from `AGENTS.md` or provider-specific skill routing.
3. Apply the rules from those skills during implementation.
4. If no skill covers a required pattern, mark it as a knowledge gap and ask whether to create or update a skill.

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
- Use `skill-sync` after creating or modifying skills.
- Run production build commands only when the human explicitly requests production verification.

## Related Skills

- `how-to-plan` - Planning protocol before development
- `agent-teams` - Multi-agent orchestration for non-trivial work
- `buildcheck-dev` - Development verification through Docker watch-mode logs
- `skill-sync` - Synchronize skill metadata and generated agent files

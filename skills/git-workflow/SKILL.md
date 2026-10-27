---
name: git-workflow
description: >
  Vendix git rules: branches from origin/develop, local commits, push/PR only on request, no AI signatures, migration alerts, PR review gate, Linear links.
  Trigger: committing, branching, pushing, opening or merging PRs, resolving conflicts.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "3.1"
  scope: [root]
---

# Git Workflow

Base `develop`, local commits, push/PR/merge only on request, zero AI signatures, no `git stash` and the
≥80 % PR gate are in `AGENTS.md`. This skill adds only the rest.

## Tooling

Use `gh` for every GitHub operation (`gh pr create|view|diff|review|merge|edit|comment`,
`gh issue …`, `gh api …`), not the GitHub MCP tools. Plain `git` for local work.

## Branches and commits

- Branch or worktree from `origin/develop`, never `main` or a stale local `develop`:
  `git fetch origin && git checkout -b feature/x origin/develop` or
  `git worktree add -b feature/x ../vendix-x origin/develop`. Keep current with `git rebase origin/develop` (or merge).
- Names: `feature/`, `fix/`, `hotfix/`, `refactor/`, `chore/`, `migration/` + short description.
- Commit: `<type>: <imperative summary>`; types `feat fix refactor chore docs test style perf hotfix migration`.
- In a shared tree stage explicit paths, never `git add -A` / `git add .`.
- "No AI signature" covers every text: commits, PR bodies, reviews, issue comments. Only real people as co-authors.

## Migrations: alert in commit and PR

Commit body:
```
⚠️ DATABASE MIGRATION ⚠️
- ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'pending'
```
PR body: a `## ⚠️ DATABASE MIGRATION` section with "This PR requires running migrations before
deployment." and the statements in one clean, copyable ```sql block.

## PR description

Story first (AGENTS.md): "Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>", the
human on-screen steps to test it and the observable acceptance criteria; technical notes, migration
block and `## Linear` below. `pr-code-review` checks this.

## Conflicts

Always resolve in the feature branch (`git fetch origin && git merge origin/develop`), never on
`develop`/`main`.

| Conflict | Action |
| --- | --- |
| Formatting / imports | Take the new change |
| Business logic | Keep both if possible, prioritize the new one |
| Config files | Manual merge preserving both |
| Ambiguous or risky | Ask the user with the options |
| Migrations | Always ask the user |

## PR gate

Run `pr-code-review` on every PR. ≥80 % (only `✅ VERIFIED` findings count) → pass. Below → fix the
verified findings in the same branch and re-review; after 2 correction rounds still below → stop and
report to Rafael. Never merge below 80 % "with comments". Reviewer: file + line + fix, blocking vs.
nice-to-have.

## Engram with the push

On a fresh pull: `./scripts/engram-import.sh`. If the push carries new knowledge saved under project
`vendix`: `./scripts/engram-sync.sh vendix` and commit the staged chunks (`chore(engram): sync memories`).
Details: `vendix-engram`.

## Linear (suggested, ask, never block)

- **Opening a PR to `develop`** (RULE 9): ask whether it maps to a Linear issue; if yes, add a
  `## Linear` section (`QUI-XXX — title — url`) and suggest moving it to `Code Review`.
- **Merging `develop` → `main`** (RULE 10, the release): collect the shipped `QUI-XXX`, confirm, move
  each to `In Review` and clear the three workflow labels; report moved and skipped.

Flows, guards and IDs: `references/linear-transitions.md` (leer bajo demanda). Linear writes go through
`linear-issues`.

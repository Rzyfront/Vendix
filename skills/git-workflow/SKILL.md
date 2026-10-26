---
name: git-workflow
description: >
  Vendix git rules: branches from origin/develop, local commits, push/PR only on request, no AI signatures, migration alerts, PR review gate, Linear links.
  Trigger: committing, branching, pushing, opening or merging PRs, resolving conflicts.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "3.0"
  scope: [root]
---

## When to Use

- When making any commit in the project
- When creating or updating Pull Requests
- When creating or naming branches
- When resolving merge conflicts with `develop`
- When pushing changes

---

## Tool Preference: GitHub CLI `gh` (PRIORITY)

**ALWAYS use `gh` CLI for GitHub operations.** Do not use GitHub MCP tools (`mcp__github__*`).

| Operation           | `gh` CLI (preferred)                         | Avoid                                     |
| ------------------- | -------------------------------------------- | ----------------------------------------- |
| Create PR           | `gh pr create`                               | `mcp__github__create_pull_request`        |
| Create branch       | `git checkout -b` + `git push`               | `mcp__github__create_branch`              |
| View PRs            | `gh pr list`                                 | `mcp__github__list_pull_requests`         |
| View issues         | `gh issue list` / `gh search issues`         | `mcp__github__list_issues`                |
| Read repo files     | `gh api repos/OWNER/REPO/contents/PATH`      | `mcp__github__get_file_contents`          |
| View PR diff        | `gh pr diff N`                               | `mcp__github__pull_request_read`          |
| Comment on PR/issue | `gh pr comment N` / `gh issue comment N`     | `mcp__github__add_issue_comment`          |
| Create review       | `gh pr review N`                             | `mcp__github__pull_request_review_write`  |
| Push files          | `git add` + `git commit` + `git push`        | `mcp__github__push_files`                 |
| Merge PR            | `gh pr merge N`                              | `mcp__github__merge_pull_request`         |

**Reason:** `gh` CLI is locally authenticated, reliable, and does not depend on the GitHub MCP server. Only use native `git` for local operations (e.g., `git status`, local `git diff`, `git worktree`).

---

## Critical Patterns

### RULE 1: main/master Protection (BLOCKING)

**NEVER** push directly to `main` or `master`. All changes must go through a development branch + PR.

```
FORBIDDEN:
  git push origin main
  git push origin master
  git checkout main && git commit

CORRECT:
  git checkout -b feature/my-change
  # ... make changes and commits ...
  git push origin feature/my-change   # only when Rafael asks to push
  # create PR targeting develop
```

### RULE 2: Zero AI Signatures (ABSOLUTE — NON-NEGOTIABLE)

**NEVER** include any signature, footer, attribution, or mention of AI tools in **any** output. This covers commits, PRs, reviews, comments, issue comments, and absolutely anything else.

```
FORBIDDEN (never include, anywhere):
  Co-Authored-By: Claude <noreply@anthropic.com>
  Co-Authored-By: [any AI or bot]
  "Hecho con Claude Code"
  "Hecho con [any AI agent]"
  "Generated with [any AI tool]"
  "Powered by [any AI tool]"
  Any footer/signature mentioning AI involvement
  Any emoji + AI attribution (e.g. 🤖 Generated with...)

CORRECT:
  git commit -m "feat: add form validation"
  PR body: only technical content, no signatures
  Review comments: only technical content, no signatures
```

Only co-authors who are **real people** on the team are allowed. This rule has **ZERO exceptions** and applies to **every single piece of text** produced.

### RULE 3: DB Migrations Require Alerts in Commit and PR

When a change includes database migrations (ALTER TABLE, CREATE TABLE, DROP, etc.), the commit and PR **must** document the changes in the description.

Format for commits with migrations:

```
feat: add status field to orders table

⚠️ DATABASE MIGRATION ⚠️
- ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'pending'
- CREATE INDEX idx_orders_status ON orders(status)
```

Format for PRs with migrations — ALTERs go in a clean, copyable SQL block:

```markdown
## Summary
Add status field to orders

## ⚠️ DATABASE MIGRATION
> **ATTENTION**: This PR requires running migrations before deployment.

\`\`\`sql
ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'pending';
CREATE INDEX idx_orders_status ON orders(status);
\`\`\`
```

### RULE 4: Conflict Resolution

Conflicts with `develop` are **always** resolved in the development branch, never directly in
`develop` or `main`.

```bash
# CORRECT: bring origin/develop into your branch and resolve there
git fetch origin
git merge origin/develop
# resolve conflicts, then stage only the resolved files
git add <resolved-files>
git commit -m "merge: resolve conflicts with develop"

# FORBIDDEN: resolving conflicts on develop/main directly
```

### RULE 5: Branch From `origin/develop`; Commit Locally, Push on Request

- **Base:** every branch or worktree starts from `origin/develop` — never `main`, never a stale local
  `develop`. Keep it current with `git fetch origin && git rebase origin/develop` (or merge).
- **Commits:** local commits per unit of work are allowed and encouraged (they protect work in a
  shared tree). Stage explicit paths, not `git add -A` / `git add .`, when other agents share the tree.
- **Push / PR / merge:** only when Rafael explicitly asks.
- **Worktrees:** allowed (RDD uses them) unless Rafael says otherwise for a task:
  `git worktree add -b feature/x ../vendix-x origin/develop`.
- **`git stash`: forbidden** when the tree has other changes or other agents are working in it — it
  captures and moves their work. To compare with the committed version use `git show HEAD:<path>` or
  `git diff HEAD -- <path>`.

```bash
git fetch origin
git checkout -b feature/my-change origin/develop
# FORBIDDEN: git checkout -b feature/my-change main
```

**Why:** CI and PR review run against `develop`; a drifted branch accumulates conflicts and
re-triggers reviews.

### RULE 6: Engram — Import Team Memories Before Working

The Engram plugin already injects the memory protocol (context, search, save). This repo adds only
the **team sync**: at the start of work on a fresh pull, import the chunks teammates committed.

```bash
./scripts/engram-import.sh          # imports .engram/chunks into ~/.engram/engram.db
```

### RULE 7: Engram — Sync Memories With the Push

When a push carries new knowledge (decision, non-obvious bugfix, pattern, gotcha), make sure it was
saved to Engram under project `vendix`, then stage the exported chunks in the same push:

```bash
./scripts/engram-sync.sh vendix     # exports and stages .engram/chunks + manifest
git commit -m "chore(engram): sync memories"
```

Never save secrets or throwaway notes. Details: `vendix-engram`.

### RULE 8: PR Review Gate — `pr-code-review` ≥ 80%, Max 2 Correction Rounds (BLOCKING)

Every PR passes the `pr-code-review` skill before merge. It is the team's PR gate.

- **Pass:** score ≥ 80% (only `✅ VERIFIED` findings count — see `pr-code-review` Evidence Gate).
- **Below 80%:** fix the verified findings in the same branch and re-review. **At most 2 correction
  rounds.** If the PR still does not pass after the second round, **stop and report to Rafael** with
  the remaining findings — no review/fix loop "until clean".
- Never merge below 80% "with comments".

```bash
gh pr review <N> --repo OWNER/REPO     # post the pr-code-review result
gh pr merge <N> --repo OWNER/REPO      # only after >= 80% and only when Rafael asks
```

Reviewer duties: file + line + suggested fix; separate blocking (security, regression, data loss)
from nice-to-have; no AI signature (RULE 2).

### RULE 9: Link the PR to its Linear Issue (SUGGESTED — ask, don't block)

**At the end of the PR flow** (right after opening — or just before opening — a PR to `develop`), check whether the change maps to a Linear issue and, if so, document it in the PR. This is a **suggestion with confirmation**, never a blocker: if the user says no, continue normally.

**Flow:**

1. **Ask the user:** "¿Este cambio corresponde a un issue/ticket de Linear?"
2. **If the user says yes:**
   - Invoke the **`linear-issues`** skill (`search` action) to find it — build the term from the PR title / branch name / key changes. If the user already gives a `QUI-XXX`, resolve that directly.
   - Show the candidate(s) and confirm the right one with the user. Never guess silently.
   - **Document it in the PR body** — add a `## Linear` section with `QUI-XXX — title — url` using `gh pr edit <N> --body` (or include it when running `gh pr create`).
   - **Suggest moving the issue to `Code Review`** — see the state transition below.
3. **If the user says no** (or there is no issue): continue without linking — do not invent an issue.

```markdown
## Linear
- QUI-418 — FIX/ Error al aprobar reseña [ecommerce]
  https://linear.app/quickss/issue/QUI-418
```

**State transition on PR open (SUGGESTED — ask, don't block):**

Once the issue is confirmed, suggest moving it to **`Code Review`** — the state that means "the code is written, the PR is open, it is waiting on a human reviewer". Never apply it silently.

- **Target state:** `Code Review` (`17d15a4c-92b4-4d6e-92d7-bc7c201fb465`), and no other. Opening a PR never moves an issue to `In Review`, `Done`, or backwards.
- **Allowed source states:** `Backlog`, `Todo`, `In Progress`. These are the states an issue can legitimately be in when its PR is opened.
- **Terminal-state guard:** if the issue is in `Done` / `Canceled` / `Duplicate`, **ask for extra confirmation** before reopening it into `Code Review` — a PR against a closed issue usually means the reference is wrong.
- **Already past this stage:** if the issue is already in `In Review`, do NOT pull it backwards. Report it and leave it alone — it is likely a follow-up PR on a change that already reached QA.
- Delegate the write to the **`linear-issues`** skill. Do NOT call the Linear API from here directly.

**Where this sits in the pipeline:**

```
Backlog → Todo → In Progress → Code Review ───────→ In Review → Done
                     ↑              │  ↑                 │        ↑
                     │              │  └─ +Aprobado      │        │ QA OK
                     │              │     +Requiere      │        │
                     │              │      cambios       │        │
                     │              │     (bucle PR)     │        │
                     │         git-workflow         git-workflow  QA
                     │         RULE 9               RULE 10   verify-ticket-prod
                     │         (abrir PR)           (release   
                     │                               develop→main)
                     └──── +Devuelto, prioridad Alta ─────┘  (QA falla)
```

`Code Review` and `In Review` are different gates and must not be conflated: `Code Review` is **pre-merge** (revisión técnica del diff), `In Review` is **post-release** (el cambio ya está en **producción** y QA lo verifica contra el requerimiento).

Merging the PR to `develop` does **not** move the issue — it only adds the `Aprobado` label (`pr-code-review`). The issue stays in `Code Review` through every review round trip.

**Why:** Linking the PR to its issue closes the loop — reviewers see the context, and each stage updates Linear on its own trigger. Separating state (where the ticket is) from label (what the last reviewer decided) is what lets `Code Review` absorb N review iterations without the ticket bouncing between states on every push. Without the `Code Review` stage, an issue waiting days on a reviewer is indistinguishable from one still being coded.

### RULE 10: Release to Prod Moves Tickets to In Review (SUGGESTED — ask, don't block)

**A release is the merge of a PR from `develop` into `main`.** That is the only trigger — there is no release tag or separate release branch in this repo.

When the reviewer merges `develop` → `main`, every ticket shipped in that release moves to **`In Review`** and gets its workflow labels **cleared**. Suggest it, confirm the list with the user, never apply it silently.

**Flow (after `gh pr merge <N>` where base is `main`):**

1. **Build the ticket list.** Collect the `QUI-XXX` references from the commits in the release:
   ```bash
   gh pr view <N> --json commits --jq '.commits[].messageHeadline' | grep -oE 'QUI-[0-9]+' | sort -u
   # or, if the release PR body lists them:
   gh pr view <N> --json body --jq .body | grep -oE 'QUI-[0-9]+' | sort -u
   ```
   Cross-check against Linear: every issue currently in `Code Review` **with the `Aprobado` label** is a release candidate. Show the user the union and let them confirm or trim it — a release PR can carry tickets whose commit messages never named them.
2. **For each confirmed ticket, via the `linear-issues` skill:**
   - `stateId` → **In Review** (`d123e233-1f17-422e-b7c0-06f463e798df`).
   - `labelIds` → current labels **minus all three workflow labels** (`Aprobado`, `Requiere cambios`, `Devuelto`). A ticket in `In Review` carries **no workflow label** — the code-review verdict already did its job and dragging it into the QA phase is misleading.
3. **Guards:**
   - A ticket still tagged **`Requiere cambios`** should not be in a release. Flag it and ask before moving it — it usually means an unmerged PR got swept into the list.
   - A ticket already in `In Review`, `Done`, `Canceled` or `Duplicate` → skip it, report it, do not move it backwards.
4. **Report what moved and what was skipped.** A release touching 20 tickets where 3 were skipped must say which 3 and why. Silent partial application is how tickets get lost.

**Why:** `In Review` is the QA queue. Filling it at release time — not at merge-to-develop time — is what makes the state mean "this is live in production, go verify it". QA picks the queue up from there with `verify-ticket-prod`.

---

## Decision Tree

```
Where am I making the change?
  → On main/master          → STOP. Create a branch first.
  → On a development branch → Is it up to date with origin/develop?
      → No  → git fetch && git rebase origin/develop (or merge) first.
      → Yes → Continue.

Did I import the team's Engram chunks after pulling?
  → No  → ./scripts/engram-import.sh
  → Yes → Continue.

Does the change include DB migrations?
  → Yes → Add ⚠️ MIGRATION block in commit and PR.
  → No  → Normal commit.

Does the change introduce new knowledge (decision / gotcha / pattern)?
  → Yes → Save it to Engram (project vendix), then ./scripts/engram-sync.sh vendix
          and commit the chunks with the push.
  → No  → Continue.

Are there conflicts with develop?
  → Yes, they are clear    → Resolve in development branch in favor of the new changes without breaking existing ones.
  → Yes, they are ambiguous → Ask the user which resolution option they prefer.
  → No                      → Continue normally.

About to push or open a PR?
  → Only if Rafael asked. Otherwise keep local commits.
  → PR opened → pr-code-review. >= 80% → APPROVE.
  → < 80% → fix verified findings, re-review. Max 2 correction rounds;
            still < 80% → stop and report to Rafael.

Did I just open a PR to develop?  (RULE 9 — suggested)
  → Ask: "¿Este cambio corresponde a un issue/ticket de Linear?"
      → Yes → linear-issues (search) → confirm match → document it in the
              PR body (## Linear: QUI-XXX — title — url) via gh pr edit.
              Then suggest moving the issue to Code Review.
      → No  → Continue without linking.

Did I just merge a PR whose base is main?  (RULE 10 — that IS the release)
  → Collect QUI-XXX from the release commits + every issue in Code Review
    tagged Aprobado. Confirm the list with the user.
  → For each: state → In Review, and CLEAR all three workflow labels
    (Aprobado / Requiere cambios / Devuelto).
  → Ticket tagged 'Requiere cambios' in the list → flag and ask, do not move.
  → Already In Review/Done/Canceled/Duplicate → skip and report.
  → Report what moved AND what was skipped. Never apply partially in silence.

Does any output have an AI signature/footer?
  → ALWAYS remove. No exceptions. Applies to commits, PRs, reviews, comments — everything.
```

---

## Conflicts: Resolution Rules

| Situation                                 | Action                                                    |
| ----------------------------------------- | --------------------------------------------------------- |
| Clear conflict (formatting only, imports) | Resolve in favor of the new change                        |
| Conflict in business logic                | Keep both changes if possible, prioritize the new one     |
| Ambiguous or risky conflict               | Ask the user showing the options                          |
| Conflict in config files                  | Manual merge, preserve both configurations                |
| Conflict in migrations                    | Always ask the user (high risk)                           |

---

## Branching: Naming Conventions

```
feature/short-description       # New functionality
fix/bug-description              # Bug fix
hotfix/urgent-description        # Urgent fix for production
refactor/what-is-refactored      # Refactoring
chore/technical-task             # Technical tasks (deps, config)
migration/migration-name         # Changes that include migrations
```

---

## Commits: Format

```
<type>: <short description in imperative>

[optional body with more detail]

[⚠️ DATABASE MIGRATION if applicable]
```

Valid types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`, `hotfix`, `migration`

---

## Commands

```bash
# Branch hygiene
git fetch origin                                       # Update remote refs
git checkout -b feature/name origin/develop            # Branch off origin/develop
git worktree add -b feature/name ../vendix-name origin/develop   # Or an isolated worktree
git rebase origin/develop                              # Keep current branch current
git show HEAD:<path>                                   # Committed version (never git stash)

# Engram team sync (the plugin handles save/search/context)
./scripts/engram-import.sh                             # Import team chunks (start of work)
./scripts/engram-sync.sh vendix                        # Export + stage chunks for commit

# PR review
gh pr review <N> --repo OWNER/REPO                     # Post a review (use pr-code-review first)
gh pr merge <N> --repo OWNER/REPO                      # Only after review >= 80% and on request

# Link a PR to its Linear issue (RULE 9 — after asking the user)
gh pr edit <N> --repo OWNER/REPO --body "$(gh pr view <N> --json body --jq .body)

## Linear
- QUI-XXX — <title>
  https://linear.app/quickss/issue/QUI-XXX"        # delegate the search to linear-issues

# Day-to-day
git push origin feature/name                           # Only on request; never to main
git merge origin/develop                               # Bring develop into your branch to resolve conflicts
git log --oneline -10                                  # View latest commits
```

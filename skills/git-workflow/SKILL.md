---
name: git-workflow
description: >
  Rules and patterns for commits, PRs, branching, and conflict resolution.
  Trigger: When making commits, creating PRs, working with branches, or resolving git conflicts.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "git commit, git push, create PR, create branch"
    - "resolve merge conflicts"
    - "changes with database migrations"
    - "Branching off or rebasing onto origin/dev before work"
    - "Pulling the latest Engram memories (engram sync --import) before starting work"
    - "Saving an Engram memory before pushing non-trivial changes"
    - "Running an automated code review (pr-code-review) on a PR before merging"
---

## When to Use

- When making any commit in the project
- When creating or updating Pull Requests
- When creating or naming branches
- When resolving merge conflicts with main/master
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

**Reason:** `gh` CLI is locally authenticated, reliable, and does not depend on the GitHub MCP server. Only use native `git` for local operations (e.g., `git status`, local `git diff`, `git stash`).

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
  git push origin feature/my-change
  # create PR targeting main
```

### RULE 2: Zero AI Signatures (ABSOLUTE — NON-NEGOTIABLE)

**NEVER** include any signature, footer, attribution, or mention of AI tools in **any** output. This covers commits, PRs, reviews, comments, issue comments, and absolutely anything else.

```
FORBIDDEN (never include, anywhere):
  Co-Authored-By: Claude <noreply@anthropic.com>
  Co-Authored-By: GitHub Copilot <noreply@github.com>
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

Conflicts with main must **always** be resolved in the development branch, never directly in main.

```bash
# CORRECT: bring main into your branch and resolve there
git checkout feature/my-branch
git merge main
# resolve conflicts in the development branch
git add .
git commit -m "merge: resolve conflicts with main"

# FORBIDDEN: resolve conflicts in main
git checkout main
git merge feature/my-branch  # Do NOT do this directly
```

### RULE 5: Branches Must Be Up to Date With `dev` (origin) Before Work

**Always work on a branch that is up to date with `origin/dev`.** No work on stale branches, no work branched off `main` directly, no work on a branch that has diverged from `dev` by more than the current sprint.

```bash
# CORRECT: branch off origin/dev, rebase/merge frequently
git fetch origin
git checkout dev
git pull --rebase origin dev
git checkout -b feature/my-change

# CORRECT: keep your branch current with dev while you work
git fetch origin
git rebase origin/dev   # or: git merge origin/dev

# FORBIDDEN: branching off main, branching off a local dev that has not been pulled,
# or pushing a feature branch that is 50 commits behind origin/dev
git checkout -b feature/my-change main   # NO
```

**Why:** Vendix's CI and PR review pipeline run against `dev`. A branch that has drifted will accumulate merge conflicts and re-trigger reviews, wasting cycle time.

### RULE 6: Engram Memory — Pull Before Working

**Always pull the latest team memories before starting work.** Memories hold decisions, gotchas, and context that are not in the code. Skipping this step means the agent (or the dev) re-discovers things the team already learned.

```bash
# CORRECT: at the start of any session / branch
./scripts/engram-import.sh        # or: engram sync --import
engram context <project>         # or: mem_context via MCP
```

**Why:** Engram stores project-level decisions (architecture, bugs, patterns) in compressed chunks. If the team merged a memory last week about a Prisma scope quirk, you want it before you write the migration.

### RULE 7: Engram Memory — Save New Memories When Pushing

**Whenever you push changes that include new knowledge, save an Engram memory first and ensure the chunks are staged in the same commit (or in a follow-up `chore(engram): sync memories` commit on the same branch).** The team's shared brain only stays alive if every push adds to it.

```bash
# CORRECT: save a memory for any non-trivial change, then push it
engram save "<title>" "<what/why/where/learned>" --type <type> --project vendix
./scripts/engram-sync.sh vendix   # or rely on the pre-push hook (Level 1 automation)
git push

# FORBIDDEN: pushing code that introduced a new pattern / decision / gotcha
# without an accompanying Engram memory
```

**What to save:**
- A new architectural decision (why we picked X over Y).
- A bugfix with a non-obvious root cause.
- A new reusable pattern the team should follow.
- A gotcha that the next dev/agent will hit.

**What NOT to save:**
- Secrets, tokens, internal URLs.
- Throwaway debug notes.
- Decisions already captured in code comments or in `AGENTS.md` (no duplication).

See `vendix-engram` for the full save pattern and conflict resolution.

### RULE 8: PRs Require Auto Code Review (BLOCKING)

**Every Pull Request MUST go through an automated code review using the `pr-code-review` skill before it can be merged.** The dev is responsible for running the review and for **re-developing the solutions that the review identifies**, not for ignoring the feedback.

**Pass threshold: the review must pass with at least 80% of the 7 analysis categories clean** (regression, security, logic, syntax, core files, code quality, and one more — see `pr-code-review`). A PR below 80% must be sent back to the dev for fixes.

```bash
# CORRECT: review the PR, address findings, re-review, then merge
gh pr review <N> --repo OWNER/REPO
# If < 80% → fix the issues in the branch, push, re-run the review
# If >= 80% → APPROVE

# FORBIDDEN: merging a PR without a posted code review
gh pr merge <N>   # without a prior pr-code-review pass and APPROVE
```

**Dev responsibilities when the review fails:**
1. Read every finding in the posted review.
2. Implement the fixes in the same branch (not in a new one).
3. Push the fixes and request a re-review.
4. Repeat until the review passes the 80% threshold.

**Reviewer responsibilities:**
- Be specific: file path + line + suggested fix.
- Distinguish **blocking** issues (security, regression, data loss) from **nice-to-have** comments.
- Never post an AI signature (see RULE 2).

**Why:** Unreviewed PRs accumulate tech debt, security holes, and cross-domain breakage. The 80% threshold is the floor — teams should aim higher.

---

---

## Decision Tree

```
Where am I making the change?
  → On main/master          → STOP. Create a branch first.
  → On a development branch → Is it up to date with origin/dev?
      → No  → git fetch && git rebase origin/dev (or merge) first.
      → Yes → Continue.

Did I pull the latest Engram memories for this project?
  → No  → Run ./scripts/engram-import.sh and engram context <project>.
  → Yes → Continue.

Does the change include DB migrations?
  → Yes → Add ⚠️ MIGRATION block in commit and PR.
  → No  → Normal commit.

Does the change introduce new knowledge (decision / gotcha / pattern)?
  → Yes → Save an Engram memory first (mem_save ... --project vendix),
          then ensure the chunk is committed (manual or via pre-push hook).
  → No  → Continue.

Are there conflicts with dev?
  → Yes, they are clear    → Resolve in development branch in favor of the new changes without breaking existing ones.
  → Yes, they are ambiguous → Ask the user which resolution option they prefer.
  → No                      → Continue normally.

About to push or open a PR?
  → Run the pr-code-review skill on the diff (or ask the agent to).
  → If the review posts findings → address them in the branch, re-review.
  → If the review is >= 80% clean → APPROVE → merge.

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
git checkout dev && git pull --rebase origin dev       # Refresh local dev
git checkout -b feature/name origin/dev                # Branch off origin/dev
git rebase origin/dev                                  # Keep current branch current

# Engram memory lifecycle
./scripts/engram-import.sh                             # Pull team memories (start of work)
engram context vendix                                  # Load recent context
engram save "..." "..." --type <type> --project vendix  # Save a memory
./scripts/engram-sync.sh vendix                        # Stage chunks for commit
./scripts/install-engram-hooks.sh                      # Optional: pre-push hook (Level 1 automation)

# PR review
gh pr review <N> --repo OWNER/REPO                     # Post a review (use pr-code-review first)
gh pr merge <N> --repo OWNER/REPO                      # Only after review >= 80% clean

# Day-to-day
git checkout -b feature/name                           # Create new branch
git push origin feature/name                           # Push to branch (never to main)
git merge origin/dev                                   # Bring dev into your branch to resolve conflicts
git log --oneline -10                                  # View latest commits
```

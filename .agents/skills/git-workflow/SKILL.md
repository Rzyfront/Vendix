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

---

## Decision Tree

```
Where am I making the change?
  → On main/master          → STOP. Create a branch first.
  → On a development branch → Continue.

Does the change include DB migrations?
  → Yes → Add ⚠️ MIGRATION block in commit and PR.
  → No  → Normal commit.

Are there conflicts with main?
  → Yes, they are clear    → Resolve in development branch in favor of the new changes without breaking existing ones.
  → Yes, they are ambiguous → Ask the user which resolution option they prefer.
  → No                      → Continue normally.

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
git checkout -b feature/name     # Create new branch
git push origin feature/name     # Push to branch (never to main)
git merge main                   # Bring main into your branch to resolve conflicts
git log --oneline -10            # View latest commits
```

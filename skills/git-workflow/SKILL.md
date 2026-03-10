---
name: git-workflow
description: >
  Rules and patterns for commits, PRs, branching, and conflict resolution.
  Trigger: When making commits, creating PRs, working with branches, or resolving git conflicts.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
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

## Tool Preference: GitHub MCP (PRIORITY)

**If the GitHub MCP server is available, ALWAYS prefer using MCP tools over bash git commands.** This applies especially to:

| Operation            | Preferred MCP Tool                                        | Avoid                                 |
| -------------------- | --------------------------------------------------------- | ------------------------------------- |
| Create PR            | `mcp__github__create_pull_request`                        | `gh pr create` via Bash               |
| Create branch        | `mcp__github__create_branch`                              | `git checkout -b` + `git push`        |
| View PRs             | `mcp__github__list_pull_requests`                         | `gh pr list` via Bash                 |
| View issues          | `mcp__github__list_issues` / `mcp__github__search_issues` | `gh issue list` via Bash              |
| Read repo files      | `mcp__github__get_file_contents`                          | `gh api` via Bash                     |
| View PR diff         | `mcp__github__pull_request_read` (method: get_diff)       | `gh pr diff` via Bash                 |
| Comment on PR/issue  | `mcp__github__add_issue_comment`                          | `gh pr comment` via Bash              |
| Create review        | `mcp__github__pull_request_review_write`                  | `gh pr review` via Bash               |
| Push files           | `mcp__github__push_files`                                 | `git add` + `git commit` + `git push` |
| Merge PR             | `mcp__github__merge_pull_request`                         | `gh pr merge` via Bash                |

**Reason:** MCP tools provide structured, typed access with better error handling than CLI commands. Only use `git` via Bash for local operations that have no MCP equivalent (e.g., `git status`, local `git diff`, `git stash`).

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

### RULE 2: No AI Co-authors (MANDATORY)

**NEVER** add `Co-Authored-By` lines from AI or automated tools in commit messages. This rule is **absolute and non-negotiable**.

```
FORBIDDEN (never include):
  Co-Authored-By: Claude <noreply@anthropic.com>
  Co-Authored-By: GitHub Copilot <noreply@github.com>
  Co-Authored-By: [any AI or bot]

CORRECT:
  git commit -m "feat: add form validation"
  (no automated co-authorship lines)
```

Only co-authors who are **real people** on the team are allowed.

### RULE 3: DB Migrations Require Alerts in Commit and PR

When a change includes database migrations (ALTER TABLE, CREATE TABLE, DROP, etc.), the commit and PR **must** document the changes in the description.

Format for commits with migrations:

```
feat: add status field to orders table

⚠️ DATABASE MIGRATION ⚠️
- ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'pending'
- CREATE INDEX idx_orders_status ON orders(status)
```

Format for PRs with migrations:

````markdown
## Summary

Add status field to orders

## ⚠️ DATABASE MIGRATION

> **ATTENTION**: This PR requires running migrations before deployment.

| Operation    | Table  | Details                                         |
| ------------ | ------ | ----------------------------------------------- |
| ALTER TABLE  | orders | ADD COLUMN status VARCHAR(50) DEFAULT 'pending' |
| CREATE INDEX | orders | idx_orders_status ON orders(status)             |

### Migration Commands

```bash
npx prisma migrate deploy
```
````

````

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
````

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

Does the commit have an AI co-author?
  → ALWAYS remove. No exceptions.
```

---

## Conflicts: Resolution Rules

| Situation                                | Action                                                    |
| ---------------------------------------- | --------------------------------------------------------- |
| Clear conflict (formatting only, imports)| Resolve in favor of the new change                        |
| Conflict in business logic               | Keep both changes if possible, prioritize the new one     |
| Ambiguous or risky conflict              | Ask the user showing the options                          |
| Conflict in config files                 | Manual merge, preserve both configurations                |
| Conflict in migrations                   | Always ask the user (high risk)                           |

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

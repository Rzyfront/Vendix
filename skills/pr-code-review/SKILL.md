---
name: pr-code-review
description: >
  Skill for reviewing Pull Requests from any GitHub repository using MCP tools.
  Analyzes security, logic, syntax, core files, and code quality.
  Trigger: When the user asks to review PRs, analyze PR code, or do code review.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    [
      "revisar PR",
      "review PR",
      "analizar PR",
      "code review",
      "revisar pull request",
    ]
---

## When to Use

Use this skill when:

- The user asks to review open PRs from one or more repositories
- Code from a PR needs to be analyzed before approving it
- You want to evaluate the quality and security of proposed changes
- The user asks for systematic code review

---

## Requirements: GitHub MCP Server

This skill **requires** the GitHub MCP server (`github`) to work. Before starting any review, verify that it is available.

### How to detect if it is installed

Try running `mcp__github__get_me`. If it works, the MCP is ready. If it fails or the tool does not exist, the user needs to install it.

### If it is NOT installed — Offer help

Tell the user:

> To review PRs I need the GitHub MCP server. Would you like me to help you install it?

#### Installation

The GitHub MCP server is configured in `~/.claude/settings.json` (global) or `.claude/settings.json` (project):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<TOKEN>"
      }
    }
  }
}
```

#### Steps for the user

1. **Create a Personal Access Token (PAT)** on GitHub:
   - Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Create a token with permissions: `repo` (full), `read:org`, `read:user`
   - For private repos, the `repo` scope is essential

2. **Add the config** to the settings file:

   ```bash
   # Global (works across all projects)
   ~/.claude/settings.json

   # Or per project (this repo only)
   .claude/settings.json
   ```

3. **Restart Claude Code** so it loads the MCP server

4. **Verify** by running: `mcp__github__get_me` — it should return the authenticated user

#### Minimum token permissions by functionality

| Functionality                 | Required permissions  |
| ----------------------------- | --------------------- |
| List PRs / view diffs         | `repo` (read)         |
| Post reviews / comments       | `repo` (write)        |
| Search repos from an org      | `read:org`            |
| View user info                | `read:user`           |
| Private repos                 | `repo` (full control) |

#### Troubleshooting

```
Error: "Resource not accessible by personal access token"
→ The token does not have the `repo` scope or does not have access to that repo/org

Error: "Bad credentials"
→ The token expired or was revoked, create a new one

Error: Tool `mcp__github__*` does not exist
→ The MCP server is not configured or Claude Code needs to be restarted
```

---

## Critical Patterns

### Pattern 1: Complete Review Flow (step by step)

```
STEP 1 → Identify repos and list open PRs
STEP 2 → Take the first PR and get metadata + files
STEP 3 → Get the full diff and analyze it
STEP 4 → Present findings to the user with a rating
STEP 5 → Wait for decision: approve, request changes, or next PR
STEP 6 → If a review is posted, use MCP tools to leave the comment
STEP 7 → Repeat with the next PR
```

### Pattern 2: The 6 Analysis Categories (ALWAYS review all of them)

| #   | Category          | What to look for                                                                                                     | Severity |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **Security**      | XSS (unsanitized innerHTML), SQL injection, missing auth, exposed secrets, unvalidated inputs                        | HIGH     |
| 2   | **Logic**         | Race conditions, inconsistent states, falsy values (`\|\| 0` vs `?? 0`), memory leaks, duplicate API calls          | HIGH     |
| 3   | **Syntax**        | Typos, missing brackets, incorrect imports, code that does not compile                                               | HIGH     |
| 4   | **Core Files**    | Changes in router, store, package.json, configs — evaluate impact on other modules                                   | MEDIUM   |
| 5   | **PR Scope**      | Mixed features, changes unrelated to the title, "sneaky" changes buried in the diff                                  | MEDIUM   |
| 6   | **Quality**       | Hardcoded values, missing error handling, debug console.logs, duplicated code, inconsistent patterns                 | LOW      |

### Pattern 3: Rating System

```
90-100%  → APPROVE — Clean, no issues
70-89%   → APPROVE with minor comments — Low-quality issues
50-69%   → REQUEST CHANGES — Logic bugs or medium issues
30-49%   → REQUEST CHANGES — Security issues or critical bugs
 0-29%   → REQUEST CHANGES — Multiple critical issues, PR needs a rewrite
```

### Pattern 4: Presentation Format for the User

Always present each PR in this format:

```markdown
# PR #NNN — `repo` — "PR title"

**Author:** username | **Files:** N | **+adds / -dels** | **Branch:** head → base

## Modified files

(table with file, changes, what it does)

## Findings

(organized by severity: CRITICAL > HIGH > MEDIUM > LOW)
(each finding with: file, approximate line, relevant code, explanation, suggested fix)

## Core files touched

(table with file, risk level, note)

## Rating: XX/100

(the good, the bad, recommendation: APPROVE or REQUEST CHANGES)
```

### Pattern 5: Review Message Format for GitHub

When the user approves posting the review, use natural and direct language:

```markdown
Hi [author], [brief positive comment about the PR].
There are [N] things to review before merging:

**1. [Issue title] ([severity])**
`file.ext` ~L[line] — [clear and concise explanation]. [Suggested fix with code if applicable]:
\`\`\`typescript
// suggested code
\`\`\`

**2. [Issue title] ([severity])**
`file.ext` ~L[line] — [explanation].

[Final summary: what is most important to fix]
```

Message rules:

- Natural language, not robotic
- Start with something positive about the PR
- Issues ordered by severity (critical first)
- Abbreviated file references: `file.ext ~LNNN`
- Include fix code only when it is short and clear
- Close with a summary of what is most urgent

---

## Decision Tree

```
Did the user ask to review PRs?
│
├─ Did they specify repos? → Use those repos
│  └─ NO → Ask or search for the user's/org's repos
│
├─ Did they specify a PR number? → Go directly to that PR
│  └─ NO → List open PRs and review one by one
│
├─ Is the diff very large (>3000 lines)?
│  └─ YES → Use subagent (Task tool) to analyze the full diff
│  └─ NO → Analyze inline
│
├─ After presenting findings:
│  ├─ User says "approve" → Post APPROVE review
│  ├─ User says "post" / "leave review" → Post REQUEST_CHANGES review
│  ├─ User says "next" → Go to the next PR
│  └─ User asks for a fix plan → Create a detailed correction plan
│
└─ Are there PRs from the same author in both frontend AND backend?
   └─ YES → Mention possible relationship between PRs (complete front+back feature)
```

---

## MCP Tools Reference

### Discover repos and PRs

```
# Get current user
mcp__github__get_me

# Search repos from an org
mcp__github__search_repositories  query="org:ORGNAME"

# List open PRs
mcp__github__list_pull_requests  owner, repo, state="open"
```

### Analyze a specific PR

```
# PR metadata (title, author, branch, mergeable)
mcp__github__pull_request_read  method="get", owner, repo, pullNumber

# List of changed files (+adds, -dels, status)
mcp__github__pull_request_read  method="get_files", owner, repo, pullNumber

# Full diff (KEY for code analysis)
mcp__github__pull_request_read  method="get_diff", owner, repo, pullNumber

# Existing reviews (to avoid duplicates)
mcp__github__pull_request_read  method="get_reviews", owner, repo, pullNumber
```

### Post a review

```
# Simple review (one general comment)
mcp__github__pull_request_review_write
  method="create"
  owner, repo, pullNumber
  event="APPROVE" | "REQUEST_CHANGES" | "COMMENT"
  body="review message"

# Review with comments on specific lines (advanced)
# Step 1: Create a pending review (without event)
mcp__github__pull_request_review_write  method="create", owner, repo, pullNumber

# Step 2: Add comments to specific lines
mcp__github__add_comment_to_pending_review  owner, repo, pullNumber, path, line, body, subjectType="LINE", side="RIGHT"

# Step 3: Submit the review
mcp__github__pull_request_review_write  method="submit_pending", owner, repo, pullNumber, event="REQUEST_CHANGES", body="summary"
```

---

## Analysis Checklist by File

### Frontend (Angular/TypeScript)

```
[ ] innerHTML / [innerHTML] → Sanitized with DomSanitizer?
[ ] Direct HTTP calls → Should it use the project's service/interceptor?
[ ] Subscriptions → Are they cleaned up in ngOnDestroy or using takeUntilDestroyed?
[ ] Async operations → Do they have error handling?
[ ] @Output without explicit type
[ ] Leftover debug console.log
[ ] Hardcoded URLs, IDs, or magic strings
[ ] Changes in routing/store/package.json → Impact on other modules?
[ ] New dependencies in package.json → Are they reliable? Bundle size?
[ ] Signals vs Observables → Is the correct project pattern used?
```

### Backend (NestJS/TypeScript)

```
[ ] Raw SQL queries without Prisma → Possible SQL injection
[ ] Unvalidated user input (missing DTO with class-validator)
[ ] Routes/endpoints without auth guards (missing @Public or missing @UseGuards)
[ ] Hardcoded secrets/credentials
[ ] Missing try/catch in DB/filesystem operations
[ ] Changes in Prisma migrations → Are they reversible?
[ ] Changes in config/routes → Do they break other endpoints?
[ ] N+1 queries in loops (use Prisma include/select)
[ ] File uploads without type/size validation
[ ] Error responses that expose internal info (stack traces, paths)
[ ] Prisma scoped service → Is the correct service used for the domain?
[ ] withoutScope() → Is it really necessary? (see vendix-prisma-scopes)
```

### General

```
[ ] The PR title describes what actually changes
[ ] No unrelated mixed features
[ ] No "sneaky" configuration changes buried in the diff
[ ] || vs ?? for falsy values (0, '', false)
[ ] error.message vs error.msg (native Error objects use .message)
[ ] Methods called multiple times in template (should be computed/signal)
```

---

## Common Issues (Recurring patterns)

### Issue 1: `|| 0` vs `?? 0`

**Problem**: `value || 0` fails when value is legitimately `0`, `''`, or `false`
**Fix**: Use `value ?? 0` (nullish coalescing — only replaces `null`/`undefined`)

### Issue 2: Repeated logic without a helper

**Problem**: The same comparison/calculation copied in 3+ places
**Fix**: Extract to a reusable helper/utility function

### Issue 3: Direct HTTP call without interceptor

**Problem**: Using native `fetch()` or `HttpClient` without the project's interceptor that includes auth tokens
**Fix**: Use the project's HTTP service that already handles headers and auth

### Issue 4: Subscriptions without cleanup

**Problem**: `.subscribe()` in components without `takeUntilDestroyed()` or `ngOnDestroy`
**Fix**: Add cleanup with `DestroyRef` + `takeUntilDestroyed()` or use `async` pipe

### Issue 5: Undocumented sneaky changes

**Problem**: Changing a default, disabling a feature, or modifying a config without mention in the PR
**Fix**: Separate into its own commit/PR or explicitly document in the description

### Issue 6: Incorrect Prisma scope

**Problem**: Using `GlobalPrismaService` in a store domain, or unnecessary `withoutScope()`
**Fix**: Use the correct scoped service for the domain (see `vendix-prisma-scopes`)

---

## Resources

- **GitHub MCP Tools**: Available via `mcp__github__*`
- **OWASP Top 10**: Reference for web security analysis
- **Angular Style Guide**: For Angular conventions (signals, standalone components)

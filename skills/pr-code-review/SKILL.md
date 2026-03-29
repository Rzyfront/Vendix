---
name: pr-code-review
description: >
  Skill for reviewing Pull Requests from any GitHub repository using GitHub CLI (gh).
  Analyzes regression, security, logic, syntax, core files, and code quality.
  Trigger: When the user asks to review PRs, analyze PR code, or do code review.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.0"
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

## Requirements: GitHub CLI (`gh`)

This skill **requires** GitHub CLI (`gh`) authenticated to work. Before starting any review, verify that it is available.

### How to verify

Run `gh auth status` via Bash. If it shows an authenticated user, it's ready.

### If it is NOT installed — Offer help

Tell the user:

> To review PRs I need `gh` CLI authenticated. Would you like me to help you install it?

#### Installation

```bash
# macOS
brew install gh

# Authenticate
gh auth login
```

#### Verification

```bash
# Should show authenticated user and scopes
gh auth status
```

#### Troubleshooting

```
Error: "gh: command not found"
→ Install with: brew install gh

Error: "not logged into any GitHub hosts"
→ Run: gh auth login

Error: "HTTP 403" or "Resource not accessible"
→ Re-authenticate with needed scopes: gh auth login --scopes repo,read:org
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
STEP 6 → If a review is posted, use `gh pr review` to leave the comment
STEP 7 → Repeat with the next PR
```

### Pattern 2: The 7 Analysis Categories (ALWAYS review all of them)

| #   | Category          | What to look for                                                                                                                                                                                                                                                                                                                                                                                                          | Severity     | Score weight                                                            |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| 1   | **Regression**    | Changes that modify existing flows, remove/rename methods used by other modules, alter function signatures, change behavior of active endpoints, modify queries consumed by other services, break data contracts between components. Prioritize that changes are **additive** (add without modifying existing). A change that touches existing flows without protection (feature flag, backwards compat) is a critical risk. | **CRITICAL** | **x3** — This criterion weighs 3 times more than any other in the final score |
| 2   | **Security**      | XSS (unsanitized innerHTML), SQL injection, missing auth, exposed secrets, unvalidated inputs                                                                                                                                                                                                                                                                                                                             | HIGH         | x1                                                                      |
| 3   | **Logic**         | Race conditions, inconsistent states, falsy values (`\|\| 0` vs `?? 0`), memory leaks, duplicate API calls                                                                                                                                                                                                                                                                                                               | HIGH         | x1                                                                      |
| 4   | **Syntax**        | Typos, missing brackets, incorrect imports, code that does not compile                                                                                                                                                                                                                                                                                                                                                    | HIGH         | x1                                                                      |
| 5   | **Core Files**    | Changes in router, store, package.json, configs — evaluate impact on other modules                                                                                                                                                                                                                                                                                                                                        | MEDIUM       | x1                                                                      |
| 6   | **PR Scope**      | Mixed features, changes unrelated to the title, "sneaky" changes buried in the diff                                                                                                                                                                                                                                                                                                                                       | MEDIUM       | x1                                                                      |
| 7   | **Quality**       | Hardcoded values, missing error handling, debug console.logs, duplicated code, inconsistent patterns                                                                                                                                                                                                                                                                                                                      | LOW          | x1                                                                      |

#### Special Regression Rule

> If a PR has **LOW regression** (additive changes, does not touch existing flows), it can get APPROVE with comments even if it has minor issues in other categories. The reviewer must inform the user of the comments so they can decide what to do.
>
> If a PR has **HIGH regression** (modifies existing flows, changes behavior of active modules), the score is penalized heavily and requires REQUEST CHANGES unless the author demonstrates that the change is protected.

**Regression Checklist (always review):**
```
[ ] Is the change additive (adds new functionality without touching existing)?
[ ] Are methods/functions that other modules call being modified?
[ ] Are function signatures changed (parameters added/removed/reordered)?
[ ] Are endpoint responses that other services/components consume being altered?
[ ] Are SQL queries that feed reports or other modules being modified?
[ ] Are props, outputs, events, or keys of shared objects removed or renamed?
[ ] Is the default behavior of something already in production being changed?
[ ] Is there protection (feature flag, fallback, backwards compat) if modifying something existing?
```

### Pattern 3: Rating System

```
Calculation: The Regression category weighs x3. All others weigh x1.
A PR with no regression issues starts with a high base score.

90-100%  → APPROVE — Clean, no issues. Low regression, additive changes.
70-89%   → APPROVE with comments — Low regression + minor issues in other categories.
                                    Inform comments to user so they can decide.
50-69%   → REQUEST CHANGES — Medium regression risk OR logic/security bugs.
30-49%   → REQUEST CHANGES — High regression risk OR critical security issues.
 0-29%   → REQUEST CHANGES — Critical regression: modifies existing flows without protection,
                              multiple critical issues. PR needs a rewrite.
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
- If the PR includes DB migrations, document the ALTERs in a clean, copyable SQL block:

```markdown
## ⚠️ DATABASE MIGRATION
> **ATTENTION**: This PR requires running migrations before deployment.

\`\`\`sql
ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'pending';
CREATE INDEX idx_orders_status ON orders(status);
\`\`\`
```

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
│  └─ YES → Use subagent (Agent tool) to analyze the full diff
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

## GitHub CLI Reference

### Discover repos and PRs

```bash
# Get current user
gh api user --jq '.login'

# Search repos from an org
gh repo list ORGNAME --limit 50

# List open PRs
gh pr list --repo OWNER/REPO --state open

# Filter with --json and --jq for large lists
gh pr list --repo OWNER/REPO --state open --json number,title,author --jq '.[] | "\(.number) \(.title) (\(.author.login))"'
```

### Analyze a specific PR

```bash
# PR metadata (title, author, branch, mergeable)
gh pr view N --repo OWNER/REPO

# List of changed files
gh pr view N --repo OWNER/REPO --json files --jq '.files[] | "\(.additions)+/\(.deletions)- \(.path)"'

# Full diff (KEY for code analysis)
gh pr diff N --repo OWNER/REPO

# Existing reviews (to avoid duplicates)
gh api repos/OWNER/REPO/pulls/N/reviews --jq '.[] | "\(.user.login): \(.state)"'
```

### Post a review

```bash
# Review APPROVE
gh pr review N --repo OWNER/REPO --approve --body "message"

# Review REQUEST_CHANGES
gh pr review N --repo OWNER/REPO --request-changes --body "message"

# Review COMMENT (without approving or requesting changes)
gh pr review N --repo OWNER/REPO --comment --body "message"

# Comments on specific lines (advanced, via API)
gh api repos/OWNER/REPO/pulls/N/comments \
  -f body="comment" \
  -f path="file.ext" \
  -F line=42 \
  -f side="RIGHT" \
  -f commit_id="$(gh pr view N --repo OWNER/REPO --json headRefOid --jq '.headRefOid')"
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
[ ] Methods called multiple times in template (should be computed/signal)
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

### Issue 0: Regression from modifying existing flows (CRITICAL)

**Problem**: A PR modifies a method, endpoint, or query that other modules/services already consume, causing existing functionality to break.
**Common examples**:
- Changing a function signature (adding required parameter) without updating all callers
- Modifying an endpoint response that the frontend already consumes with a specific structure
- Renaming a field in a SQL query that feeds a report
- Changing a default value that other modules assume
- Removing or renaming props, outputs, events, or keys of shared objects

**Fix**: Make additive changes: add the new behavior without breaking the existing one. If modifying something existing is necessary, use feature flags, optional parameters with defaults, or temporary backwards compatibility.

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

### Issue 7: Double-fetch in store actions

**Problem**: A store action (NgRx effect) already dispatches a fetch, and the component also calls fetch after
**Fix**: Trust the store effect or move the fetch logic only to the component — not both

---

## Resources

- **GitHub CLI**: `gh` — locally authenticated via `gh auth login`
- **OWASP Top 10**: Reference for web security analysis
- **Angular Style Guide**: For Angular conventions (signals, standalone components)

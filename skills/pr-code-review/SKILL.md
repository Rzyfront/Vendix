---
name: pr-code-review
description: >
  Skill for reviewing Pull Requests from any GitHub repository using GitHub CLI (gh).
  Analyzes regression, security, logic, syntax, core files, and code quality.
  Trigger: When the user asks to review PRs, analyze PR code, or do code review.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    [
      "revisar PR",
      "review PR",
      "analizar PR",
      "code review",
      "revisar pull request",
      "Running the 80% pass gate before merging a PR (git-workflow RULE 8)",
      "Re-developing solutions identified by a code review below 80%",
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

### Pattern 0: Evidence Gate — Verify Before You Claim (MANDATORY)

> **The review reports only what it has verified.** A suspicion is not a finding. A hypothesis does not affect the score. If you catch yourself writing "this could break", "the backend might reject", "verify with X before merging", or "puede romper" — STOP. **You** are the one who must run X. Execute the check, then report the *result*, not the worry.

**The rule (non-negotiable):**

1. **Every finding must be backed by an executed check.** State the evidence inline: the command you ran, the file/line you read, the DTO/endpoint you inspected. No evidence → not a finding.
2. **Unverified hypotheses NEVER enter the Findings list and NEVER move the score.** At most, list them in a separate **"Open questions for the author"** section that carries **zero** score weight and is explicitly labeled as unverified.
3. **A claim you told the reader to "verify later" is a claim you failed to verify.** This skill has Bash, file reads, and `gh` — there is no "later". Verify now or drop it.
4. **When verification flips a suspicion, say so.** "Looked like a regression; checked the backend DTO — it's `@IsOptional()` and the service does `if (!item.x) continue`, so this *aligns* the contract" is far more valuable than a vague warning that never got checked.

**How to verify by category (execute these — do not speculate):**

| Suspicion | Verification (execute, then report the result) |
|-----------|------------------------------------------------|
| "This type change could break the backend" | Read the real DTO + service: `rg -n "field_name" apps/backend/src/**/dto/*.dto.ts` and check for `@IsOptional()`; grep how the service consumes it (`if (!item.x) continue`, `.filter(...)`). A frontend TS type is compile-time only — it changes no runtime payload by itself. |
| "This endpoint may reject the new payload" | Read the controller/DTO/validator; if still unsure, `curl` the endpoint. Never guess an HTTP status. |
| "Changing this token/constant breaks call sites" | `rg -n "<old-literal>\|token-name" <scope>` to count REAL call sites. Distinguish *intentional literals* from *missed token usages*, and *pre-existing debt* from *regression this PR introduces*. A raw count overstates impact. |
| "This rename/removal leaves dangling references" | Fetch the **resulting** file at the PR head and grep it (see below) — do not trust the diff hunk alone. |
| "Required field X is now optional → 0/undefined bug" | Read the type at its definition. If it is still `required`, the `?? 0` is dead-defensive code, not a bug. |

**Read the resulting file, not just the diff hunk.** A `-` line in a hunk may be the *duplicate / dead* copy, not the active one (e.g. an object literal with duplicate keys — last definition wins). Before claiming "this removal breaks X", fetch the file at the PR head and confirm the final state:

```bash
HEAD_SHA=$(gh pr view N --repo OWNER/REPO --json headRefOid --jq '.headRefOid')
gh api -X GET "repos/OWNER/REPO/contents/path/to/file.ext" -f ref=$HEAD_SHA --jq '.content' | base64 -d > /tmp/head_file
rg -n "symbol" /tmp/head_file   # confirm what actually survives at HEAD
```

**Tag every finding with its evidence status:**
- `✅ VERIFIED` — checked against real code / DTO / head file (cite the command or path).
- `❓ OPEN QUESTION` — could not be verified from the repo (needs a running env or external service). Goes to the Open-questions section, **not** the scored Findings, and is flagged to the author.

### Pattern 1: Complete Review Flow (step by step)

```
STEP 1 → Identify repos and list open PRs
STEP 2 → Take the first PR and get metadata + files
STEP 3 → Get the full diff and analyze it — form hypotheses (suspicions, not findings yet)
STEP 4 → VERIFY every hypothesis (Pattern 0): run rg/grep, read the real file/DTO,
         fetch the head file, curl if needed. Confirm or DROP each one.
STEP 5 → Present ONLY verified findings + rating. List unverified items separately as
         "Open questions for the author" (zero score weight).
STEP 6 → Wait for decision: approve, request changes, or next PR
STEP 7 → If a review is posted, use `gh pr review` to leave the comment
STEP 8 → Repeat with the next PR
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

80-100%  → APPROVE — Clean, no issues. Low regression, additive changes.
                                  PASSES the 80% gate (git-workflow RULE 8).
70-79%   → REQUEST CHANGES — Just below the 80% gate. Re-develop the failing
                                  items and re-review. Do not merge below 80%.
50-69%   → REQUEST CHANGES — Medium regression risk OR logic/security bugs.
30-49%   → REQUEST CHANGES — High regression risk OR critical security issues.
 0-29%   → REQUEST CHANGES — Critical regression: modifies existing flows without protection,
                              multiple critical issues. PR needs a rewrite.
```

**The 80% threshold is the merge gate.** This is a hard requirement from `git-workflow` RULE 8 — no PR can be merged below 80%, regardless of how nice the comments are. A score in the 70-79% range is treated as **REQUEST CHANGES**, not as "approve with comments", because the dev must re-develop the failing items.

**Only `✅ VERIFIED` findings affect the score (see Pattern 0).** Unverified suspicions carry **zero** weight — they cannot lower (or raise) the rating, and they cannot trigger REQUEST CHANGES. If a regression doubt is the only thing pushing a PR below 80% and you have not verified it, **verify it before scoring**: if it confirms, it counts; if it cannot be confirmed from the repo, it is an Open Question, not a regression. This prevents a sound, additive, CI-green PR from being blocked on speculation. Equally: do not *inflate* a score by ignoring a verified problem — the gate cuts both ways.

**Distinguish pre-existing debt from regression introduced by this PR.** A hardcoded value or anti-pattern the PR did not touch is not a regression caused by this PR; at most it is a `Quality (x1)` follow-up, never a `Regression (x3)` blocker. Check with `git blame` / the diff whether the PR introduced it before weighting it x3.

### Pattern 4: Presentation Format for the User

Always present each PR in this format:

```markdown
# PR #NNN — `repo` — "PR title"

**Author:** username | **Files:** N | **+adds / -dels** | **Branch:** head → base

## Modified files
(table with file, changes, what it does)

## Findings  (ONLY ✅ verified — see Pattern 0)
(organized by severity: CRITICAL > HIGH > MEDIUM > LOW)
(each finding with: ✅ evidence tag — the command run or file/line checked — then file, approximate line, relevant code, explanation, suggested fix)

## Open questions for the author  (❓ unverified — ZERO score weight)
(suspicions that could not be confirmed from the repo; ask the author, never fold into the score)

## Core files touched
(table with file, risk level, note)

## Rating: XX/100
(the good, the bad, recommendation: APPROVE or REQUEST CHANGES — based ONLY on verified findings)
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

- **NEVER include AI signatures or attributions** — No "Hecho con Claude Code", "Generated with", "Co-Authored-By" AI lines, or any AI-related footer/signature anywhere. Zero exceptions. Applies to review comments, PR descriptions, commit messages, and all text output.
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

### Pattern 6: Merge Conflicts (MANDATORY CHECK)

**ALWAYS check `mergeable` status before starting the code review.** Use `gh pr view N --repo OWNER/REPO --json mergeable --jq '.mergeable'`.

**Rules (non-negotiable):**

| Condition | Action |
|-----------|--------|
| `mergeable: false` (has conflicts) | **Score: 0/100** — Automatic REQUEST CHANGES |
| `mergeable: true` | Proceed with normal review |
| `mergeable: null` (GitHub still calculating) | Wait and re-check before proceeding |

**If the PR has conflicts:**
1. **Do NOT proceed with deep code analysis.** A PR that can't be merged shouldn't be reviewed in detail.
2. **Rating is automatically 0/100** — no exceptions.
3. **Post REQUEST CHANGES** with a brief, decontextualized recommendation.
4. The review comment should follow this template:

```markdown
Hi [author], this PR has merge conflicts that need to be resolved before we can proceed with the review.

**Merge Conflicts (BLOCKING)**
This PR cannot be merged as-is. Please resolve the conflicts, favoring the most stable changes or the ones you consider most relevant for this feature.

Once conflicts are resolved, we'll proceed with the full code review.
```

**Important:** The conflict resolution recommendation is intentionally decontextualized — it does not analyze which specific lines conflicted or suggest which side is "correct." It simply guides the author to prioritize stability and relevance at their own discretion.

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
├─ Does the PR have merge conflicts? (check mergeable status FIRST)
│  └─ YES → Score 0/100, REQUEST CHANGES with decontextualized recommendation → Next PR
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

### Issue 8: Merge conflicts blocking review

**Problem**: The PR has merge conflicts (`mergeable: false`), making it impossible to merge regardless of code quality.
**Fix**: Resolve conflicts favoring the most stable changes or those the author considers most relevant. Then request re-review.
**Review action**: Automatic 0/100, REQUEST CHANGES with brief decontextualized recommendation. No deep code analysis until conflicts are resolved.

### Issue 9: Unverified hypothesis presented as a finding (REVIEW ANTI-PATTERN)

**Problem**: The review lists "this could break the backend" / "verify with curl" / "puede romper en prod" as a finding and lets it drag the score below the 80% gate — without ever running the check. This blocks sound, additive PRs on speculation, and a single wrong guess (e.g. flagging an `@IsOptional()` field as a regression) can flip an APPROVE into a REQUEST CHANGES.
**Fix**: Apply the Evidence Gate (Pattern 0). Run the check — read the DTO, `rg` the call sites, fetch the head file, `curl` the endpoint. Report the *result*, not the worry. If it genuinely cannot be verified from the repo, move it to "Open questions for the author" with zero score weight — never into scored Findings.
**Review action**: Re-score using only `✅ VERIFIED` findings. A hypothesis that could not be confirmed does not count as a regression.

---

## Re-development Workflow (When the Review Fails)

When the review posts a score **below 80%** or REQUEST CHANGES for any reason, the dev is responsible for **re-developing the solutions that the review identifies** in the same branch — not for ignoring the feedback or for arguing the review wrong.

**Cycle:**

1. **Read every finding** in the posted review. Each one is `file.ext ~LNNN` + suggested fix.
2. **Address them in the same branch** (no new branch, no "I'll fix it later" PR).
3. **Push the fixes** to the same PR.
4. **Re-run this skill** on the same PR. The diff is now smaller, the score should rise.
5. **Repeat** until the score is >= 80% clean.
6. **APPROVE → merge.**

**Escalation rules:**

- If two re-review cycles do not move the score to >= 80%, stop and ask the human for guidance — the design or scope may be wrong, not just the implementation.
- If a finding is genuinely wrong or the dev disagrees, the dev explains in a PR comment with evidence, and the human decides. The review is not a vote.
- If the failing items are all in the same module, the dev may pull the offending changes into a new commit (`refactor: address pr-review feedback`) for clarity.

**What "re-develop" means:**

- "Re-develop" is not "acknowledge and merge anyway." It is: change the code so the finding no longer applies.
- A PR cannot be merged at 75% "with comments" — that is below the 80% gate.

---

## Resources

- **GitHub CLI**: `gh` — locally authenticated via `gh auth login`
- **OWASP Top 10**: Reference for web security analysis
- **Angular Style Guide**: For Angular conventions (signals, standalone components)

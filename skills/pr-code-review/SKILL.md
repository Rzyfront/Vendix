---
name: pr-code-review
description: >
  Evidence-gated PR review with gh: user story in the description, regression, security, logic, syntax, core files, quality. Scores the 80% PR gate.
  Trigger: reviewing a PR, analyzing PR code, or a code review request.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.5"
  scope: [root]
---

# PR Code Review

Requires `gh` authenticated (`gh auth status`; if missing, offer `brew install gh && gh auth login`).
Commands and output templates: `references/templates-and-gh.md` (leer bajo demanda).

## Evidence Gate (mandatory)

A suspicion is not a finding. If you catch yourself writing "could break", "might reject", "verify
with X before merging" — run X now and report the result.

1. Every finding cites its evidence: command run, file:line read, DTO/endpoint inspected.
2. Tag: `✅ VERIFIED` (counts) or `❓ OPEN QUESTION` (could not be verified from the repo; goes to
   "Open questions for the author", **zero** score weight).
3. Say when verification flips a suspicion ("checked the DTO: `@IsOptional()`, so it aligns the contract").
4. Read the **resulting file at the PR head**, not just the hunk (a `-` line may be a dead duplicate).

| Suspicion | Verify by |
| --- | --- |
| Type change breaks backend | Read real DTO + service usage; a frontend TS type changes no payload by itself |
| Endpoint rejects payload | Read controller/DTO/validator; `curl` if still unsure |
| Constant/token change breaks call sites | `rg` real call sites; separate intentional literals and pre-existing debt |
| Rename leaves dangling refs | Grep the head file |
| Required → optional causes 0/undefined | Read the type at its definition |

## Flow

1. **Mergeable first:** `gh pr view N --json mergeable`. `false` → score **0/100**, REQUEST CHANGES with
   the conflict template, no deep analysis. `null` → wait and re-check.
2. **PR description:** read the body (`gh pr view N --json body`). It must contain the user story
   ("Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>"), the human on-screen steps to
   test it and observable acceptance criteria (AGENTS.md). Missing or purely technical → verified
   MEDIUM finding (PR Scope), first item in the review message asking the author to add it. Use the
   steps to judge whether the diff does what the story says.
3. Metadata + files + full diff → hypotheses. Diff >3000 lines → a subagent may analyze it.
4. Verify every hypothesis (Evidence Gate); drop what does not confirm.
5. Present verified findings + rating; wait for the user's decision (approve / post / next / fix plan).
6. Post with `gh pr review` only when asked. Same author with front+back PRs → mention the relation.

## Categories and score

| # | Category | Look for | Weight |
| --- | --- | --- | --- |
| 1 | **Regression** (CRITICAL) | Modified existing flows, changed signatures/responses/report queries/defaults, removed shared props/keys, no flag or backwards compat | **x3** |
| 2 | Security (HIGH) | Unsanitized innerHTML, SQL injection, missing auth, secrets, unvalidated input | x1 |
| 3 | Logic (HIGH) | Races, inconsistent state, `\|\|` vs `??`, leaks, duplicate calls | x1 |
| 4 | Syntax (HIGH) | Typos, bad imports, non-compiling code | x1 |
| 5 | Core files (MEDIUM) | Router, store, package.json, configs | x1 |
| 6 | PR scope (MEDIUM) | Mixed features, sneaky changes, missing story/test steps | x1 |
| 7 | Quality (LOW) | Hardcoded values, missing error handling, debug logs, duplication | x1 |

- **80–100 APPROVE** (passes the gate). **70–79** REQUEST CHANGES (just below the gate). **50–69**
  medium regression or logic/security bugs. **30–49** high regression or critical security. **0–29**
  unprotected rewrite of existing flows; needs a rewrite.
- Only `✅ VERIFIED` findings move the score, both ways (no blocking on speculation, no inflating by
  ignoring a verified problem).
- Low regression (additive) → may APPROVE with comments if ≥80; tell the user the comments. High
  regression → REQUEST CHANGES unless the author shows it is protected.
- Pre-existing debt the PR did not introduce is at most Quality x1, never Regression x3 (check with
  the diff / `git blame`).

Checklists by file type and recurring issues: `references/checklists.md` (leer bajo demanda).

## Review message rules

Natural language, positive opener, issues by severity, `file.ext ~LNNN`, short fix code only when
clear, closing summary of the most urgent item. No AI signature anywhere. Migrations → copyable SQL
block (`git-workflow`).

## Below 80 %: re-development

The author fixes the verified findings in the same branch and re-runs this review. **Max 2 correction
rounds**; still below → stop and report to Rafael. A disputed finding is argued with evidence in a PR
comment and the human decides. Never merge below 80 %; merge only when Rafael asks.

## Linear verdict (suggested, with confirmation)

≥80 % merged → label `Aprobado`; <80 % sent back → label `Requiere cambios`. Labels only: the issue
**never changes state** here (it stays in `Code Review`). Tiered issue search, label-set replacement
and read-back: `references/linear-verdict.md` (leer bajo demanda). Calls go through `linear-issues`.

# Output templates and gh commands

## Presentation to the user (one block per PR)

```markdown
# PR #NNN — `repo` — "PR title"
**Author:** user | **Files:** N | **+adds / -dels** | **Branch:** head → base

## User story and test steps (from the PR description)
(the story, the human steps and acceptance criteria as written — or "MISSING")

## Modified files
(table: file, changes, what it does)

## Findings (only ✅ VERIFIED)
(CRITICAL > HIGH > MEDIUM > LOW; each: evidence (command or file:line), file ~line, code, explanation, fix)

## Open questions for the author (❓ unverified, zero weight)

## Core files touched
(table: file, risk, note)

## Rating: XX/100
(good, bad, APPROVE or REQUEST CHANGES — based only on verified findings)
```

## GitHub review message

```markdown
Hi [author], [brief positive comment].
There are [N] things to review before merging:

**1. [Issue] ([severity])**
`file.ext` ~L[line] — [explanation]. [Short fix code if clear]

[Summary: what is most urgent]
```

Natural, non-robotic, positive opener, severity order, short fix code only when clear, no AI
signature. If the PR has migrations, include the `## ⚠️ DATABASE MIGRATION` block with a copyable SQL
block (format in `git-workflow`). If the story/steps are missing, ask for them as item 1:

```markdown
**1. Missing user story and test steps (MEDIUM)**
Please add to the description: "Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>",
the steps a person follows on screen to test it, and what they should see (acceptance criteria).
```

## Merge-conflict review (score 0, no deep analysis)

```markdown
Hi [author], this PR has merge conflicts that need to be resolved before we can proceed with the review.

**Merge Conflicts (BLOCKING)**
This PR cannot be merged as-is. Please resolve the conflicts, favoring the most stable changes or the ones you consider most relevant for this feature.

Once conflicts are resolved, we'll proceed with the full code review.
```

The recommendation is intentionally decontextualized (no line-level analysis of which side wins).

## gh commands

```bash
gh auth status                                   # required; if missing: brew install gh && gh auth login
                                                 # 403 → gh auth login --scopes repo,read:org
gh pr list --repo O/R --state open --json number,title,author \
  --jq '.[] | "\(.number) \(.title) (\(.author.login))"'
gh pr view N --repo O/R --json mergeable --jq .mergeable
gh pr view N --repo O/R --json body --jq .body
gh pr view N --repo O/R --json files --jq '.files[] | "\(.additions)+/\(.deletions)- \(.path)"'
gh pr diff N --repo O/R
gh api repos/O/R/pulls/N/reviews --jq '.[] | "\(.user.login): \(.state)"'   # avoid duplicate reviews

# Resulting file at PR head (do not trust the hunk alone)
HEAD_SHA=$(gh pr view N --repo O/R --json headRefOid --jq .headRefOid)
gh api -X GET "repos/O/R/contents/path/file.ext" -f ref=$HEAD_SHA --jq .content | base64 -d > /tmp/head_file

gh pr review N --repo O/R --approve|--request-changes|--comment --body "msg"
gh api repos/O/R/pulls/N/comments -f body="c" -f path="file.ext" -F line=42 -f side=RIGHT -f commit_id="$HEAD_SHA"
```

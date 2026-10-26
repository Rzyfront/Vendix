---
name: parallel
description: >
  Safety contract for parallel writer agents on independent units, in one shared tree or in worktrees: scope, commit-early, no stash or destructive git.
  Trigger: /parallel, or a plan that runs writers in parallel.
disable-model-invocation: true
license: MIT
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Parallel

Boundaries for concurrent writer agents so none corrupts a sibling's work. Whether to delegate is in
`AGENTS.md` / `how-to-plan`; general git rules in `git-workflow`. The coordinator injects these rules
into every writer prompt with an explicit allowed-file list per writer.

## When allowed

Only independent units: disjoint files and no ordering dependency (B needs A's output → sequential).
Manual invocation only (`/parallel` or a feature doc that names it). Never "to be thorough".

| Mode | When | Isolation |
| --- | --- | --- |
| **Worktrees** (default) | Unless Rafael says no | One worktree + branch per writer from the anchor (`git worktree add -b <branch> ../<dir> <sha>`). Integrate via commits/PR, never by copying files between trees. |
| **Shared tree** | Rafael asks, or worktrees impossible | Same branch and tree; scope discipline and early commits are the only protection. |

## Coordinator checkpoint (before fan-out)

1. Confirm the run branch (from `origin/develop` unless Rafael named another); `git status`; commit
   its own pending changes. Never fan out on the wrong branch or on unstaged work.
2. Record the anchor: `git rev-parse HEAD` (optionally `git tag checkpoint/parallel-<run-id>`).
3. Then spawn writers.
4. Recovery to the anchor (`git reset --hard <sha>` / `git revert`) is a deliberate coordinator or
   human decision, never a writer's; cherry-pick committed work from the reflog first.

## Writers: hard prohibitions

1. No branch changes: no `checkout`, `switch`, `checkout -b`, `branch -m`, detached HEAD.
2. No out-of-scope edits: no reformatting, cleanup or refactor of neighbor files.
3. No deletions outside the assigned scope; never delete, discard or revert another agent's files,
   changes or commits. No `rm`/`git rm` to "tidy".
4. No destructive or history-rewriting git: `reset` (any mode dropping changes), `checkout -- <path>`,
   `restore`, `clean -f*`, `rebase`, `merge`, `pull`, `push --force*`, `commit --amend` on shared
   commits, `stash` in any form, `reflog expire`, `gc --prune`, `branch -D`, `tag -d`.

A neighbor's `reset --hard` / `restore` / `clean` annihilates every unstaged change in a shared tree,
irrecoverably. It already cost a fully verified refactor at Vendix.

Allowed: read anything; edit/create inside scope; `git add <own files>` + `git commit`; read-only git;
scoped tests and log checks (`buildcheck-dev`).

## File scope and shared files

- Confirm each file is part of your assignment; never edit a file holding a sibling's uncommitted
  diff — wait for their commit and re-read fresh.
- Need a file outside scope → report a blocker, do not edit.
- Shared-file protocol (only way to mix changes in one file): both commit first → coordinator assigns
  non-overlapping regions → re-read fresh, edit only your region → `git diff` proves sibling lines
  intact → commit immediately. Overlap or doubt → stop and report.

## Commit protection

As soon as your scoped work passes its scoped check, `git add <your files>` and commit (WIP is fine)
before returning. Unstaged work dies with a sibling's reset; committed work survives. If the
coordinator forbade commits, leave files unstaged and list them exactly in the report.

## Blockers: report and wait

Out-of-scope file needed · a required file looks broken or mid-edit · you think a branch switch,
reset or pull is needed · conflict in the shared tree · you need a file with a sibling's uncommitted
diff. Never "fix" these yourself.

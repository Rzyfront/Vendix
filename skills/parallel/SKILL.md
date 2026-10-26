---
name: parallel
description: >
  Safety contract for parallel writer agents on independent units, in one shared tree or in worktrees: scope, commit-early, no stash or destructive git.
  Trigger: /parallel, or a plan that runs writers in parallel.
disable-model-invocation: true
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Parallel

## Purpose

Governs **parallel writer agents**: the boundaries each one respects so concurrent work does not
corrupt, overwrite, or destroy a sibling's work. It does not decide *whether* to parallelize (see
`how-to-plan` § Delegation) nor general git rules (see `git-workflow`).

## When Parallel Writers Are Allowed

- Only for **independent units**: disjoint file sets and no ordering dependency between them. If unit
  B needs unit A's output, run them sequentially.
- Only with a named reason (independent parallel writers is one of the four delegation reasons in
  `how-to-plan`). Never parallelize "to be thorough".
- Manual invocation only (`/parallel` or a plan/feature doc that names it). When active, the
  coordinating agent injects these rules into every writer's prompt, with an explicit allowed-file
  list per writer.

## Execution Modes

| Mode | When | Isolation |
|------|------|-----------|
| **Worktrees** (preferred for RDD) | Default for parallel writers unless Rafael says no for this task | Each writer gets its own `git worktree` on its own branch created from `origin/develop`. Integration happens later via commits/PR, never by copying files between trees. |
| **Shared tree** | Rafael asks for it, or worktrees are not possible | All writers on the same branch and working tree. A destructive command by one writer affects every other writer, so the only protection is scope discipline plus committing early. |

Base for any new branch or worktree is `origin/develop`, never `main`. All rules below apply in both
modes; they are mandatory in shared-tree mode, where a single violation can destroy sibling work.

## Coordinator Checkpoint (Pre-Fan-Out)

The **coordinator** is the agent that launches the writers (it codes too; it is not a passive
orchestrator). Before launching any writer it establishes a recovery anchor:

1. **Anchor branch + clean baseline.** Confirm the run branch (based on `origin/develop` unless
   Rafael named another), then run `git status`; if the tree has uncommitted changes the
   coordinator owns, commit them first. Never fan out on the wrong branch or on top of unstaged
   work. In worktree mode, create each writer's worktree from that anchor
   (`git worktree add -b <branch> ../<dir> <sha>`).
2. **Capture the checkpoint.** Record the current HEAD as the recovery anchor:
   ```bash
   git rev-parse HEAD                          # note this SHA — the recovery point
   git tag checkpoint/parallel-<run-id>        # optional, human-readable anchor on the same branch
   ```
   A lightweight tag does not move HEAD and does not switch branches, so it respects the model.
3. **Then fan out.** Spawn the writers only after the checkpoint exists.
4. **Recovery is deliberate and coordinator/human-only.** If the run is corrupted, returning to the
   checkpoint (`git reset --hard <sha>` or `git revert`) is a conscious, coordinated decision made by
   the coordinator or a human — it is NEVER an action a writer may take (see Hard
   Prohibitions). Any committed agent work between the checkpoint and the failure is preserved in the
   reflog/object store and can be cherry-picked before resetting.

The checkpoint complements — does not replace — the per-agent commit-early rule: the checkpoint
bounds the blast radius of the whole run; early commits protect each agent's individual work.

## Hard Prohibitions (Writers)

Writers are **completely forbidden** from the following. These are not guidelines; a single
violation can destroy sibling work irrecoverably.

1. **No branch changes.** Do NOT run `git checkout <branch>`, `git switch`, `git checkout -b`,
   `git branch -m`, or anything that moves HEAD off the current branch or detaches it. Stay on the
   branch you started on.
2. **No touching out-of-scope files.** Edit ONLY files that are directly part of your assigned
   change. Never edit, reformat, "clean up", normalize, or refactor a neighbor file in passing — it
   may be mid-edit by another agent.
3. **No deletions — especially another agent's work.** Do NOT delete repository files unless the
   deletion is explicitly part of your assigned scope — not your own out of convenience, and absolutely never anything created or changed by another agent:
   no deleting their files, no discarding their uncommitted changes, no reverting their commits
   without coordinator approval. No `rm`, no `git rm`, no deleting to "tidy the tree".
4. **No destructive or history-rewriting git.** Do NOT run any command that discards working-tree
   changes, resets state, or rewrites history. This explicitly includes:
   - `git reset --hard`, `git reset` (any mode that drops changes)
   - `git checkout -- <path>`, `git restore <path>`, `git restore .`
   - `git clean -f` / `-fd` / `-fdx`
   - `git rebase` (any form), `git merge`, `git pull`
   - `git push --force` / `--force-with-lease`
   - `git commit --amend` on already-shared commits
   - `git stash` in any form (`push`, `pop`, `apply`, `drop`, `clear`) — it captures and moves
     other agents' uncommitted changes. To compare with the committed version use
     `git show HEAD:<path>` or `git diff HEAD -- <path>`.
   - `git reflog expire`, `git gc --prune`
   - branch or tag deletion (`git branch -D`, `git tag -d`)

> A neighbor's `git reset --hard`, `git restore`, or `git clean` does NOT touch committed objects but
> **annihilates every unstaged change in the shared tree, irrecoverably** — not via stash, dangling
> objects, reflog, or editor history. This has already cost a fully verified refactor at Vendix.

## Allowed Operations

- Read any file (read-only inspection is always safe).
- Create and edit files **inside your assigned scope**.
- `git add <your-scope-files>` and `git commit` of your own scoped changes.
- `git status`, `git diff`, `git log` and other read-only git inspection.
- Scoped tests (one path per call) and log checks from `buildcheck-dev`; no builds or full suites.

## File Scope Rules

- Before touching a file, confirm it is **directly part of your assigned feature/scope**.
- Do not assume an unrelated file is canonical — it may be mid-edit by a sibling agent.
- Never edit a file holding a sibling agent's **uncommitted diff** — wait until they commit it,
  then re-read the file fresh before touching it. The only way to mix changes in one file is the
  Shared-File Protocol below.
- If your change genuinely requires modifying a file outside your scope, **STOP and report it as a
  blocker** to the coordinator; do not act on it yourself.
- When the coordinator delegates, it must hand each agent an explicit allowed-file list and forbid
  edits outside it.

## Shared-File Protocol (controlled exception)

Two agents MAY mix changes in the same file, but ONLY through this protocol — never by editing on
top of a sibling's uncommitted diff:

1. **Both commit first.** Each agent commits its own scoped work (see Commit Protection) so nothing
   about to be mixed is uncommitted.
2. **Coordinator grants access.** The coordinator assigns non-overlapping regions (or serializes
   the edits) and names the exact file + allowed region per agent.
3. **Re-read fresh, then edit your region only.** Read the file after the sibling's commit; touch
   only your assigned region.
4. **Prove no loss.** After editing, run `git diff` and confirm every sibling line is still intact
   before committing.
5. **Commit immediately** once your edit passes its scoped check — do not hold a shared file dirty.
6. **Overlap or doubt → STOP.** If both agents need the same lines, or the diff shows anything
   unexpected, report to the coordinator; never resolve it by deleting or overwriting a sibling's
   lines.

## Commit Protection

The commit is the **only durable shield** in a shared tree.

- As soon as your scoped work **passes its scoped check** (scoped test or watch log, see
  `buildcheck-dev`), `git add` your files and `git commit`
  immediately — even as WIP — before returning control.
- Do not leave verified work unstaged waiting for approval: a sibling's `reset --hard` / `restore` /
  `clean` will erase it permanently. Committed work survives those commands; unstaged work does not.
- Commit only your scoped files; never `git add -A` / `git add .` in a shared tree, which would
  stage another agent's in-progress changes.
- Commits are local. Push / PR only when Rafael asks (`git-workflow`). If the coordinator forbade
  commits for this run, leave your files unstaged and list them exactly in your report.

## Blocker Protocol

When a writer hits any of these, it **reports and waits** instead of acting:

| Situation | Action |
| --- | --- |
| Change needs a file outside your scope | Report as blocker; do not edit it. |
| A required file appears broken/mid-edit by another agent | Report; do not "fix" or revert it. |
| You believe a branch switch / reset / pull is needed | Report; never run it yourself. |
| Merge/state conflict in the shared tree | Report to the coordinator for human-coordinated resolution. |
| You need a file with a sibling's uncommitted diff | Wait for their commit and re-read; urgent cases go through the Shared-File Protocol via the coordinator. |

## Decision Rules

| Situation | Use |
| --- | --- |
| Units share files or depend on each other's output | Do not parallelize — run sequentially. |
| Independent units, Rafael has not forbidden worktrees | Worktree mode, one branch per writer from `origin/develop`. |
| Rafael asks for one shared tree | Shared-tree mode; every rule above is mandatory. |
| About to launch a parallel run | Coordinator creates the checkpoint anchor first. |
| Run got corrupted and you need to roll back | Coordinator/human-only recovery to the checkpoint; never a writer. |
| Need to see the committed version of a file | `git show HEAD:<path>` — never `git stash`. |
| Normal commit / branch / PR rules | `git-workflow` |
| Verifying a unit before the protective commit | scoped test from `buildcheck-dev` (one path per call) |

## Related Skills

- `how-to-plan` - When delegation is justified and how a parallel run is declared in a feature doc.
- `git-workflow` - Canonical commit/branch/PR/conflict rules.
- `buildcheck-dev` - Scoped test runner and log checks before the protective commit.

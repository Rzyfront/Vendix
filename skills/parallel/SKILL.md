---
name: parallel
description: >
  Governs parallel execution by multiple executive agents on the SAME current git branch and a
  shared working tree. Defines the hard prohibitions for executive agents (no branch switching, no
  touching out-of-scope files, no deletions, no destructive or history-rewriting git) and the
  commit-early protection that prevents irrecoverable loss of a neighbor's unstaged work.
  Trigger: NOT auto-invoked. Load ONLY when the user explicitly invokes it in a plan or workflow to
  run work in parallel on the current branch.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Parallel

## Purpose

This skill governs **parallel execution by multiple executive agents working on the SAME current git
branch and the SAME shared working tree**. It defines the boundaries each executive agent must
respect so concurrent work does not corrupt, overwrite, or destroy the work of sibling agents.

It governs the **safety contract** of shared-tree parallel work. It does NOT govern how to split a
task or orchestrate agents (see `agent-teams`) nor general git rules (see `git-workflow`).

## Activation

- **NOT auto-invoked.** This skill is never loaded automatically by action triggers.
- Load it **only** when the user explicitly references it inside a plan or workflow — e.g. "run this
  in parallel using the `parallel` skill" or a plan step that names it.
- When active, its rules apply to **every executive agent** spawned for that parallel run, and the
  orchestrator must inject them into each subordinate agent's prompt.

## Execution Model

- All executive agents operate on the **current branch** — the branch HEAD was on when the run
  started. There is no per-agent branch and no worktree isolation unless the user explicitly asks.
- The working tree is **shared**: a file written by one agent is immediately visible to all others,
  and a destructive command by one agent affects every other agent's in-progress work.
- Because there is no isolation, the only real protection against loss is **scope discipline plus
  committing early** (see Commit Protection).

## Orchestrator Checkpoint (Pre-Fan-Out)

Before launching any executive agent, the **orchestrator** (never an executive agent) establishes a
recovery anchor so the whole run has a guaranteed point of return:

1. **Ensure a clean, committed baseline.** Run `git status`; if the tree has uncommitted changes the
   orchestrator owns, commit them first. Never fan out on top of unstaged work.
2. **Capture the checkpoint.** Record the current HEAD as the recovery anchor:
   ```bash
   git rev-parse HEAD                          # note this SHA — the recovery point
   git tag checkpoint/parallel-<run-id>        # optional, human-readable anchor on the same branch
   ```
   A lightweight tag does not move HEAD and does not switch branches, so it respects the model.
3. **Then fan out.** Spawn the executive agents only after the checkpoint exists.
4. **Recovery is deliberate and orchestrator/human-only.** If the run is corrupted, returning to the
   checkpoint (`git reset --hard <sha>` or `git revert`) is a conscious, coordinated decision made by
   the orchestrator or a human — it is NEVER an action an executive agent may take (see Hard
   Prohibitions). Any committed agent work between the checkpoint and the failure is preserved in the
   reflog/object store and can be cherry-picked before resetting.

The checkpoint complements — does not replace — the per-agent commit-early rule: the checkpoint
bounds the blast radius of the whole run; early commits protect each agent's individual work.

## Hard Prohibitions (Executive Agents)

Executive agents are **completely forbidden** from the following. These are not guidelines; a single
violation can destroy sibling work irrecoverably.

1. **No branch changes.** Do NOT run `git checkout <branch>`, `git switch`, `git checkout -b`,
   `git branch -m`, or anything that moves HEAD off the current branch or detaches it. Stay on the
   branch you started on.
2. **No touching out-of-scope files.** Edit ONLY files that are directly part of your assigned
   change. Never edit, reformat, "clean up", normalize, or refactor a neighbor file in passing — it
   may be mid-edit by another agent.
3. **No deletions.** Do NOT delete repository files — not your own out of convenience, and
   absolutely never files outside your scope or another agent's changes. No `rm`, no `git rm`, no
   deleting to "tidy the tree".
4. **No destructive or history-rewriting git.** Do NOT run any command that discards working-tree
   changes, resets state, or rewrites history. This explicitly includes:
   - `git reset --hard`, `git reset` (any mode that drops changes)
   - `git checkout -- <path>`, `git restore <path>`, `git restore .`
   - `git clean -f` / `-fd` / `-fdx`
   - `git rebase` (any form), `git merge`, `git pull`
   - `git push --force` / `--force-with-lease`
   - `git commit --amend` on already-shared commits
   - `git reflog expire`, `git gc --prune`, `git stash drop`/`clear`
   - branch or tag deletion (`git branch -D`, `git tag -d`)

> A neighbor's `git reset --hard`, `git restore`, or `git clean` does NOT touch committed objects but
> **annihilates every unstaged change in the shared tree, irrecoverably** — not via stash, dangling
> objects, reflog, or editor history. This has already cost a fully verified refactor at Vendix.

## Allowed Operations

- Read any file (read-only inspection is always safe).
- Create and edit files **inside your assigned scope**.
- `git add <your-scope-files>` and `git commit` of your own scoped changes.
- `git status`, `git diff`, `git log` and other read-only git inspection.
- Build / test / verification commands that do not mutate the tree destructively.

## File Scope Rules

- Before touching a file, confirm it is **directly part of your assigned feature/scope**.
- Do not assume an unrelated file is canonical — it may be mid-edit by a sibling agent.
- If your change genuinely requires modifying a file outside your scope, **STOP and report it as a
  blocker** to the orchestrator; do not act on it yourself.
- When the orchestrator delegates, it must hand each agent an explicit allowed-file list and forbid
  edits outside it.

## Commit Protection

The commit is the **only durable shield** in a shared tree.

- As soon as your scoped work **passes the build**, `git add` your files and `git commit`
  immediately — even as WIP — before returning control.
- Do not leave verified work unstaged waiting for approval: a sibling's `reset --hard` / `restore` /
  `clean` will erase it permanently. Committed work survives those commands; unstaged work does not.
- Commit only your scoped files; never `git add -A` / `git add .` in a shared tree, which would
  stage another agent's in-progress changes.

## Blocker Protocol

When an executive agent hits any of these, it **reports and waits** instead of acting:

| Situation | Action |
| --- | --- |
| Change needs a file outside your scope | Report as blocker; do not edit it. |
| A required file appears broken/mid-edit by another agent | Report; do not "fix" or revert it. |
| You believe a branch switch / reset / pull is needed | Report; never run it yourself. |
| Merge/state conflict in the shared tree | Report to orchestrator for human-coordinated resolution. |

## Decision Rules

| Situation | Use |
| --- | --- |
| User invokes parallel work on the current branch in a plan/workflow | Load this skill and apply to all executive agents. |
| About to launch a parallel run | Orchestrator creates a checkpoint anchor first (see Orchestrator Checkpoint). |
| Run got corrupted and you need to roll back | Orchestrator/human-only recovery to the checkpoint; never an executive agent. |
| Deciding how to split/orchestrate the parallel agents | `agent-teams` |
| Normal commit / branch / PR rules | `git-workflow` |
| Verifying a build before the protective commit | `buildcheck-dev` |
| Agent needs an isolated branch/worktree | Out of scope — requires explicit user request, not this skill. |

## Related Skills

- `agent-teams` - How to orchestrate and delegate to subordinate agents (this skill adds the
  shared-tree safety contract on top).
- `git-workflow` - Canonical commit/branch/PR/conflict rules.
- `buildcheck-dev` - Build verification to run before the protective commit.
- `how-to-plan` - Where a parallel run is declared as a plan step.

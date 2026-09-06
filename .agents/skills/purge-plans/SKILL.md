---
name: purge-plans
description: >
  Permanently delete old or already-executed plan files to reclaim space and stop stale plans from
  polluting searches and agent context. Deletion is absolute: there is no archive, no trash, and most
  plan directories are gitignored, so a purged plan is unrecoverable. Inventories every plan with an
  inferred state (done / open / unknown), age, size and git recoverability, and refuses to delete
  anything until a human passes --apply.
  Trigger: Purging old plans, deleting executed plans, cleaning docs/plans, docs/planes,
  docs/critical-plans or .claude/plans, reclaiming space taken by plan files, or auditing which
  plans are still open before a cleanup.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Purging or deleting old plan files"
    - "Cleaning docs/plans, docs/planes, docs/critical-plans or .claude/plans"
    - "Reclaiming disk space taken by executed plans"
    - "Auditing which plans are still open before deleting anything"
allowed-tools: Read, Glob, Grep, Bash
---

# Purge Plans

## Purpose

Delete plan files that are finished or stale. Plans accumulate: a single critical plan reaches
hundreds of KB, and a directory of them slows searches, pollutes agent context, and buries the two
plans that are still alive among thirty that are not.

This skill owns **deletion of plan artifacts only**. It never touches source code, migrations,
evidence, or skills.

## The one rule that matters

**Deletion here is absolute.** `--apply` runs `rm`. There is no archive directory, no trash, no
tarball. `docs/` and `.claude/` are gitignored in this repo, so for almost every plan there is no
`git checkout` to undo it either — the `RECOVER` column says `NONE` for exactly that reason.

Consequence: **the human decides what dies.** Run `scan`, show the table, get an explicit
instruction, then run `purge --apply`. Never chain scan and apply in one breath because the numbers
looked reasonable.

## Where plans live

| Directory | What is in it | In git? |
|---|---|---|
| `docs/plans/` | Normal plans (`PLAN-*.md`) and v1 critical plans (`CP-*.md`) | No (gitignored) |
| `docs/planes/` | Older Spanish-named plans | No |
| `docs/critical-plans/` | v2 bundles (`CP-<slug>/`) and v1 single files | No, except `README.md` |
| `.claude/plans/` | Legacy plans from the Claude Code plan mode | No |

A v2 bundle is a **directory**, so purging it is `rm -rf` on the whole bundle: hub, steps,
registries, findings, logs and its `evidence/`. Purge one only when its work is closed and the
evidence is no longer needed.

## Commands

```bash
P=skills/purge-plans/assets/purge-plans.sh

$P scan                                  # inventory + verdict. Never deletes.
$P purge                                 # dry-run of the default selection
$P purge --apply                         # deletes: state=done, older than 30 days
$P purge --state any --older-than 90 --apply --yes    # everything untouched for 3 months
$P purge --all --yes --apply             # total purge of every plan directory
$P purge --dir docs/plans --keep 'QUI-727*' --apply   # one directory, protecting a family
```

Defaults are conservative on purpose: `--state done --older-than 30`. Widen them explicitly.

| Option | Effect |
|---|---|
| `--dir <path>` | Restrict to one plan directory (repeatable) |
| `--state done\|open\|unknown\|any` | Which inferred state to select (default `done`) |
| `--older-than <days>` | Only entries untouched for N days (default 30) |
| `--keep <glob>` | Protect basenames matching the glob (repeatable) |
| `--all` | Ignore state and age: select everything |
| `--yes` | Required when the selection includes non-`done` plans or `--all` |
| `--apply` | Actually delete. Without it nothing is touched. |

Exit codes: `0` ok · `1` nothing selected · `2` usage error, or a destructive run refused for lack
of `--yes`.

## How state is inferred

| State | Signal |
|---|---|
| `done` | v2 bundle whose hub frontmatter says `status: done`; or a v1 markdown whose first 60 lines carry `ejecutado`, `cerrado`, `completado`, `archivado` or `100%`; or ticked checkboxes with none open |
| `open` | Has unticked `- [ ]` items and no closing marker |
| `unknown` | No usable signal |

The heuristic reads text, so it is a hint, not a verdict. **`unknown` is not `done`.** Many plans
written as prose carry no checkboxes at all and land in `unknown` — read the table before widening
`--state`, rather than assuming the script knows.

`README.md`, `AGENTS.md`, `CLAUDE.md` and `.gitkeep` are never selected, even under `--all`: they
are documentation living beside the plans, not plans. Delete one by hand if you really mean it.

## Workflow

1. **Scan.** `$P scan` — or `$P scan --state any` to see everything, not just the finished ones.
2. **Show the human the table.** Selected count, total size, and which entries say `RECOVER NONE`.
3. **Get an explicit instruction** naming the criteria: state, age, directories, exceptions.
4. **Dry-run the exact command** you intend to apply. Confirm the selection matches what was agreed.
5. **Apply.** Add `--apply` (and `--yes` when the selection is not purely `done`).
6. **Report** what was deleted and how much was freed. If a plan documented a decision worth
   keeping, save it to Engram (`vendix-engram`) **before** the purge — the file is the only copy.

## What this skill will not do

- Delete without `--apply`, or delete non-`done` plans without `--yes`.
- Touch anything outside the plan directories passed to it.
- Delete the evidence of an **open** plan because it looked old.
- Decide on its own that a purge is due. Disk pressure is not authorization.

## Related Skills

- `how-to-plan` — produces the plans this skill deletes
- `how-to-critical-plan` — produces the v2 bundles; a bundle's `evidence/` dies with it
- `vendix-engram` — persist a decision worth keeping before its plan is purged
- `git-workflow` — most plan directories are gitignored, so git is not a safety net here

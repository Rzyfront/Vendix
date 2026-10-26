---
name: purge-plans
description: >
  Permanently deletes finished or stale plan files (docs/plans, docs/critical-plans, odd/tasks) after a scan and an explicit human --apply.
  Trigger: /purge-plans, or Rafael asks to purge old plans.
disable-model-invocation: true
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
  scope: [root]
allowed-tools: Read, Glob, Grep, Bash
---

# Purge Plans

Deletes plan artifacts only; never source, migrations or skills. Critical plans are no longer
produced: what remains are leftovers to purge, plus ODD feature docs.

## The one rule

`--apply` runs `rm`: no archive, no trash. `docs/` and `.claude/` are gitignored, so there is no git
undo (`RECOVER NONE`). **The human decides what dies:** scan, show the table, get an explicit
instruction, dry-run, then apply. Never chain scan and apply. Disk pressure is not authorization.

## Where plans live

| Directory | Content | In git |
| --- | --- | --- |
| `docs/critical-plans/` | Legacy `CP-<slug>/` bundles (hub, steps, findings, `evidence/`) — purged with `rm -rf` on the whole bundle | No (except `README.md`) |
| `docs/plans/` | Legacy `PLAN-*.md` / single-file plans | No |
| `odd/tasks/` | ODD feature docs (`## Specs`, `## Tasks`, `## Log`) | Yes once committed |

The script defaults also include `docs/planes` and `.claude/plans` (absent today; skipped). `odd/tasks/`
is not a default: pass `--dir odd/tasks`. A feature doc with every task ticked infers `done`; a
committed one is recoverable from git, an uncommitted one is not.

## Commands

```bash
P=skills/purge-plans/assets/purge-plans.sh
$P scan                                   # inventory + verdict, never deletes (--state any to see all)
$P purge                                  # dry-run: state=done, older than 30 days
$P purge --apply                          # delete that selection
$P purge --state any --older-than 90 --apply --yes
$P purge --dir docs/critical-plans --all --yes --apply
$P purge --dir docs/plans --keep 'QUI-727*' --apply
```

| Option | Effect |
| --- | --- |
| `--dir <path>` | Restrict to a directory (repeatable) |
| `--state done\|open\|unknown\|any` | Inferred state to select (default `done`) |
| `--older-than <days>` | Untouched for N days (default 30) |
| `--keep <glob>` | Protect matching basenames (repeatable) |
| `--all` | Ignore state and age |
| `--yes` | Required for non-`done` selections or `--all` |
| `--apply` | Actually delete |

Exit: `0` ok · `1` nothing selected · `2` usage error or destructive run refused without `--yes`.

## State inference (a hint, not a verdict)

- `done`: bundle hub frontmatter `status: done`; or first 60 lines contain `ejecutado`, `cerrado`,
  `completado`, `archivado` or `100%`; or all checkboxes ticked.
- `open`: unticked `- [ ]` and no closing marker.
- `unknown`: no signal. **`unknown` is not `done`** — prose plans land here; read the table before widening `--state`.

`README.md`, `AGENTS.md`, `CLAUDE.md`, `.gitkeep` are never selected, even with `--all`.

## Workflow

1. `$P scan` (or `--state any`).
2. Show count, total size and which entries are `RECOVER NONE`.
3. Get an explicit instruction naming state, age, directories and exceptions.
4. Dry-run the exact command; confirm it matches.
5. Apply (`--yes` if not purely `done`).
6. Report what was deleted and the space freed. Save any decision worth keeping to Engram
   (`vendix-engram`) **before** purging — the file is the only copy. Never delete the evidence of an open plan.

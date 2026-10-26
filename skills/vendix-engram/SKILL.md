---
name: vendix-engram
description: >
  Vendix team layer on top of the Engram plugin: project vendix, chunk sync/import via scripts, onboarding bootstrap, health checks, hard rules.
  Trigger: syncing or importing team memories, onboarding Engram, or Engram health issues.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
---

# Vendix Engram — Team Memory Layer

The Engram plugin already injects the daily memory protocol (context at start, search, proactive
save, session summary, conflict judging). **Do not restate it here.** This skill covers only what is
specific to Vendix: the project name, how memories travel between teammates through git, onboarding,
and health checks.

## Project

- All Vendix memories use project **`vendix`** — pass `--project vendix` explicitly on CLI calls.
  Worktrees have other folder names (e.g. `Vendix-wt-*`), so do not rely on the repo basename.
- Local SQLite `~/.engram/engram.db` is each dev's source of truth. The repo carries only the
  compressed chunks in `.engram/chunks/` plus `.engram/manifest.json`.

## Team Sync

| When | Command | Effect |
|------|---------|--------|
| After `git pull` / at the start of work | `./scripts/engram-import.sh` | Imports teammates' chunks from `.engram/chunks/` into the local DB |
| Before pushing work that saved new memories | `./scripts/engram-sync.sh vendix` | Exports new memories as chunks and **stages** `.engram/chunks` + `manifest.json` |

After `engram-sync.sh`, review with `git diff --cached .engram/` and commit (in the same push or as
`chore(engram): sync memories`). Push only when Rafael asks (`git-workflow`).

Optional automation: `./scripts/install-engram-hooks.sh` installs a pre-push hook that exports and
folds new chunks into the last commit (`--status`, `--uninstall`; bypass with
`ENGRAM_SKIP_PRE_PUSH=1 git push`). Offer it; do not install it unasked.

## Onboarding (fresh machine)

When `engram` is missing (`command -v engram`) or a dev just cloned the repo:

1. **Ask first.** Never run the bootstrap or install Homebrew packages without explicit confirmation.
2. Run, passing the agent in use (only these two are supported):

   ```bash
   ./scripts/engram-bootstrap.sh --agent claude-code
   ./scripts/engram-bootstrap.sh --agent gemini-cli
   ```

   It is **idempotent**: installs via brew only if missing, runs `engram doctor`, `engram setup
   <agent>` only if needed, and `engram sync --import` when `.engram/chunks/` exists.
3. Tell the dev to **restart the agent** so it reloads the Engram MCP subprocess.

## Health Check

```bash
engram doctor                              # read the `next:` field of any blocked check
engram stats                               # 0 memories but .engram/chunks exists → re-run import
engram conflicts list --project vendix     # resolve consciously; never overwrite blindly
```

| Symptom | Fix |
|---------|-----|
| `engram: command not found` | Onboarding above (with confirmation) |
| MCP tools missing in the agent | Restart the agent after `engram setup <agent>` |
| Import does nothing | Check `.engram/chunks/` exists and is not gitignored |
| Pre-push hook did not stage chunks | `engram stats` — the hook no-ops when nothing is new |

## Hard Rules

1. **Never commit `~/.engram/engram.db`** (gitignored — verify before every PR). Only
   `.engram/chunks/` and `.engram/manifest.json` go to git.
2. **Never store secrets** (API keys, tokens, passwords, internal credentials). Memories are plain text.
3. **No temporary notes** — Engram is for durable knowledge (decisions, non-obvious bugfixes,
   patterns, gotchas), not debug scratch.
4. **Always `--project vendix`** so memories stay grouped and sync correctly.

## Related Skills

- `git-workflow` — RULES 6–7 wrap import/sync around the commit and push flow.
- `vendix-known-errors` — where a newly paid trap is also documented.

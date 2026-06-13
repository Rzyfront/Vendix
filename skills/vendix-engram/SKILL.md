---
name: vendix-engram
description: >
  Persistent shared memory for Vendix via Engram. Covers self-bootstrap for new
  devs, the daily save/search/context/sync cycle, project scope conventions
  (--project vendix), and how to handle memory conflicts. Trigger this skill
  whenever Engram is mentioned, when the user asks about cross-session or
  cross-agent memory, or when the agent detects Engram is not installed and the
  user wants the team-memory workflow enabled.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Saving or consulting persistent project memory with Engram (mem_save, mem_search, mem_context, mem_sync)"
    - "Setting up or migrating an Engram installation (brew, setup, MCP, plugin, doctor)"
    - "Self-bootstrap Engram on a fresh dev machine"
    - "Onboarding a new developer to the team's Engram memory"
---

# Vendix Engram — Persistent Shared Memory

## What this is

Engram is a Go binary + SQLite + FTS5 that gives **AI coding agents and devs a shared brain** for this project. It survives sessions, syncs across the team via compressed git chunks, and works with any MCP-capable agent (Claude Code, OpenCode, Gemini CLI, Codex, Pi, VS Code, Cursor, Windsurf).

Local SQLite (`~/.engram/engram.db`) is the source of truth. The repo carries only the compressed chunks in `.engram/chunks/` plus a `manifest.json` (the DB itself is gitignored).

## Project scope

All Vendix memories are saved under `--project vendix` (or whatever `basename` of the repo root resolves to). The repo carries a `.engram/` folder with the team's chunk index.

## Self-bootstrap for a new dev (or new machine)

When the agent detects that `engram` is not installed — or that the user just cloned the repo and asks about memory — offer to run the bootstrap script. Always ask the user for explicit confirmation before running it; do not auto-install Homebrew packages.

### Detection

```bash
command -v engram            # missing = needs install
test -d "$HOME/.engram"      # missing = fresh DB
test -d .engram/chunks       # present = team has shared memories to import
```

### Run the bootstrap (with user consent)

```bash
# Detect the agent in use and pass it explicitly
./scripts/engram-bootstrap.sh --agent opencode
# or --agent claude-code | gemini-cli | codex | pi
# add --yes to skip the doctor confirmation
```

The script is **idempotent**: it skips any step that's already done, runs `brew install` only if `engram` is missing, runs `engram setup <agent>` only if needed, and runs `engram sync --import` only if `.engram/chunks/` exists.

### After the bootstrap

Tell the user to **restart their agent** so it reloads the Engram MCP subprocess. Then verify with:

```bash
engram stats
```

If `engram stats` shows 0 memories but `.engram/chunks/` exists in the repo, the import step didn't pick them up — re-run `engram sync --import` manually.

## Daily workflow (for the agent)

### Start of session

```bash
engram context vendix        # CLI; or call mem_context via MCP
```

This pulls recent observations and conflicts for the project so the agent doesn't re-derive context.

### Before non-trivial changes

```bash
engram search "<keyword>" --project vendix
```

If a relevant memory exists, prefer its guidance over re-investigating. If `mem_judge` reports a conflict, surface it to the user before proceeding.

### After meaningful work

Save a memory with the What/Why/Where/Learned pattern:

```bash
engram save \
  "<short title>" \
  "<body: what changed, why, where in the repo, and what was learned>" \
  --type <architecture|decision|bugfix|learning|pattern> \
  --project vendix
```

Types guide future search and conflict detection:
- `architecture` — structural decision (lives across the whole project)
- `decision` — explicit choice with trade-offs
- `bugfix` — what broke and why
- `learning` — non-obvious gotcha the next dev will hit
- `pattern` — reusable code pattern this team uses

If `mem_save` returns a `candidates[]` block, a similar memory already exists. Decide explicitly:
- New memory supersedes old → call `mem_update` on the old one with a `supersedes` link.
- New memory is parallel → save anyway; the conflict marker is benign.
- Old is wrong → delete the old one and save fresh.

### End of session / before commit

Stage any new chunks so the team gets them on their next pull:

```bash
./scripts/engram-sync.sh vendix
git add .engram/
git commit -m "chore(engram): sync memories"
```

The other side:

```bash
./scripts/engram-import.sh
```

## Sync automation (3 levels)

The default is **manual** — devs run the sync script before relevant commits. This works, but people forget. The team can graduate to one of two automations:

### Level 0 — Manual (default)

- Dev runs `./scripts/engram-sync.sh vendix` and commits chunks explicitly.
- Pros: zero magic, fully predictable, no surprises in PRs.
- Cons: devs forget. New memories stay local until someone remembers.

### Level 1 — Pre-push hook (recommended once the team is comfortable)

Install the bundled hook so `git push` automatically stages and amends new chunks before sending commits. Runs `engram sync --quiet`, no-op when nothing is new, never blocks a push.

```bash
./scripts/install-engram-hooks.sh           # one-time per machine
./scripts/install-engram-hooks.sh --status  # verify
```

The hook:
- Skips silently if `engram` is not installed (e.g. CI, Docker) — never breaks a push.
- Skips silently if no new memories were exported — zero overhead on most pushes.
- Folds the new chunks into the last commit via `git commit --amend` (override with `ENGRAM_HOOK_AMEND=0`).
- Chains around an existing pre-push hook if one is present.
- Can be bypassed per-push with `git push --no-verify` or `ENGRAM_SKIP_PRE_PUSH=1 git push`.
- Removed with `./scripts/install-engram-hooks.sh --uninstall`.

Offer this hook to the team after a week of Level 0, once the manual flow feels stable.

### Level 2 — Autosync (Engram Cloud only)

Engram's `ENGRAM_CLOUD_AUTOSYNC=1` daemon runs sync in the background to an Engram Cloud server. This **only applies if the team adopts Engram Cloud** (which the current Vendix setup does not). Not recommended for git-chunk workflows.

### When to upgrade

| Signal | Upgrade to |
| --- | --- |
| Devs keep asking "did you save that as a memory?" | Level 1 |
| Team > 5 devs and PRs frequently miss chunks | Level 1 |
| Different timezones, async standups, chunks lag by days | Level 2 (only if cloud is already adopted) |
| A single dev on a single machine | Stay at Level 0 |

## Hard rules

1. **Never commit `~/.engram/engram.db`** — the `.gitignore` blocks it, but verify before every PR.
2. **Never store secrets** (API keys, tokens, passwords) in memories. Engram is plain text.
3. **Don't use Engram for throwaway debug notes** — it's for durable project knowledge.
4. **Don't skip the project scope** — every `mem_save` must have `--project vendix` (or the repo basename) so memories stay grouped.
5. **Don't bypass `mem_judge` conflicts** — when it flags a contradiction, resolve it consciously, don't overwrite.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `engram: command not found` | `brew install gentleman-programming/tap/engram` |
| MCP tools missing in agent | Restart the agent after `engram setup <agent>` (the running stdio subprocess does not auto-reload) |
| `engram sync --import` does nothing | Check `.engram/chunks/` exists in the repo and is not gitignored |
| `engram doctor` shows `blocked` | Run `engram doctor` and read the `next:` field for each blocked check |
| Cloud sync 401 | Token expired. Re-run `engram cloud config --server <url>` with a fresh token |
| Conflict spam | `engram conflicts list --project vendix`, then resolve or `mem_update` to mark `supersedes` |
| Pre-push hook blocks a push | `git push --no-verify` once, or `ENGRAM_SKIP_PRE_PUSH=1 git push` |
| Pre-push hook did not stage new chunks | Check `engram stats` actually shows new memories; the hook no-ops when there is nothing to export |

## What this skill does NOT cover

- **Engram Cloud setup** — local-first is the default. If the team needs cloud sync, that warrants its own decision and probably its own skill.
- **Per-developer private memories** — the convention is project-scoped. If a dev wants private notes, they can use a different `--project` (e.g. `personal-rzy`) and just not sync those chunks.
- **Embedding-based semantic search** — Engram uses FTS5 (lexical). For semantic search over memories, see the optional `--semantic` flag in `engram conflicts scan`.

## Related Vendix skills

- `vendix-monorepo-workspaces` — for adding the bootstrap to `package.json` scripts (`pnpm run memory:bootstrap`) if the team prefers that entry point.
- `git-workflow` — for the commit/PR flow that wraps the sync.
- `skill-creator` — if the team develops new memory patterns that need their own skill.

---
name: skill-sync
description: >
  Syncs skill metadata to AGENTS.md Auto-invoke sections.
  Trigger: When updating skill metadata (metadata.scope/metadata.auto_invoke), regenerating Auto-invoke tables, or running ./skills/skill-sync/assets/sync.sh (including --dry-run/--scope).
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "After creating/modifying a skill"
    - "Regenerate AGENTS.md Auto-invoke tables (sync.sh)"
    - "Troubleshoot why a skill is missing from AGENTS.md auto-invoke"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Skill Sync

## Purpose

Use this skill to keep `AGENTS.md` auto-invoke tables and provider-specific skill copies aligned with the source files in `skills/`.

## Source Of Truth

- Source skills live in `skills/{skill-name}/SKILL.md`.
- `metadata.scope` and `metadata.auto_invoke` generate `AGENTS.md` auto-invoke rows.
- Provider copies live in `.claude/skills`, `.opencode/skills`, and `.agent/skills` after setup sync.
- Do not manually edit generated provider copies; edit `skills/` and sync.

## Standard Frontmatter

```yaml
---
name: my-skill
description: >
  Short description.
  Trigger: Specific situation that should load this skill.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Action that should load this skill"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---
```

`allowed-tools` is optional and stays at the top level, not inside `metadata`.

## Scope Values

| Scope | Target |
| --- | --- |
| `root` | `AGENTS.md` |
| `backend` | `apps/backend/AGENTS.md` if present |
| `frontend` | `apps/frontend/AGENTS.md` if present |
| `ecommerce` | `apps/ecommerce/AGENTS.md` if present |

If a scoped `AGENTS.md` file does not exist, the sync script warns and skips that scope.

## Commands

```bash
# Update AGENTS.md auto-invoke tables from metadata
./skills/skill-sync/assets/sync.sh

# Preview auto-invoke table changes
./skills/skill-sync/assets/sync.sh --dry-run

# Sync only one scope
./skills/skill-sync/assets/sync.sh --scope root

# Copy source skills to provider-specific locations
./skills/setup.sh --sync
```

## Required Workflow

After creating or modifying a skill:

1. Update the source file under `skills/`.
2. Ensure frontmatter has `metadata.scope` and `metadata.auto_invoke` when the skill should auto-load.
3. Run `./skills/skill-sync/assets/sync.sh`.
4. Run `./skills/setup.sh --sync`.
5. Run `./skills/skill-sync/assets/sync.sh` again if provider sync rewrote generated root instructions.
6. Verify the source skill, generated provider copy, and `AGENTS.md` entries.

## Troubleshooting

- Missing from `AGENTS.md`: check `metadata.scope` and `metadata.auto_invoke`.
- Warning for missing scoped `AGENTS.md`: either create that scoped file intentionally or use `scope: [root]`.
- Provider copy stale: run `./skills/setup.sh --sync` after editing source skills.

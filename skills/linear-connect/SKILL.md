---
name: linear-connect
description: >
  Bootstrap local Linear setup for Vendix (Quickss workspace): validate LINEAR_API_KEY and cache
  team/project/labels/state UUIDs in .linear/config.json. Trigger: /linear-connect, "configurar
  Linear", "conectar a Linear", missing LINEAR_API_KEY.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Bootstrapping local Linear credentials for Vendix"
    - "Configuring the Vendix Linear API key"
    - "Resolving and caching Vendix team/project/labels UUIDs in .linear/config.json"
    - "Recovering from a missing or invalid LINEAR_API_KEY in the Vendix repo"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
disable-model-invocation: true
---

# Linear Connect (Vendix · Quickss)

One-shot bootstrap per developer/machine: `LINEAR_API_KEY` in the user's shell env + UUID cache in
`.linear/config.json`. Issue work is `linear-issues`.

## Key storage (security rule)

- The key lives **only** in the user's environment, never in a repo file (not `.linear/config.json`,
  not a repo `.env`, even gitignored: backups, syncs and reflog keep it).
- Options, in order: macOS Keychain (`security add-generic-password -s linear-mavis -a $USER -w '<key>'`
  + `security find-generic-password` wrapper in `~/.zshrc`); 1Password
  (`export LINEAR_API_KEY="$(op read 'op://Private/Linear/api_key')"`); plain export in `~/.zshrc`
  (fallback `~/.bashrc`) with `chmod 600`.
- The agent appends the line itself if absent (`grep -q '^export LINEAR_API_KEY='` first), never
  echoes the key, and refuses any request to store it in the repo.
- Agents load an existing key with `source scripts/load-linear-key.sh` (prints only length/prefix).

## Procedure

1. If `LINEAR_API_KEY` is set, skip to 3. If `.linear/config.json` exists, check its `team_id` /
   `project_id` match the constants; if not, warn and ask before rebuilding.
2. Generate the key: `https://linear.app/quickss/settings/account/security/api-keys/new`, label
   `Vendix (<hostname>)`, default scopes (not Admin). Shown once. Store it as above.
3. Validate: `viewer { id name email }`. Errors → regenerate. Show "Conectado como <name> <email>";
   identity not theirs → STOP.
4. Confirm access: `team(id: "64581e80-05a2-40e8-8acb-1f091ad38168") { id name key }` (Quickss, QUI)
   and `project(id: "0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59") { id name }` (Vendix).
5. Verify every cached UUID resolves (dead labels/states fail silently at write time):
   `issueLabels(first: 100, includeArchived: true) { nodes { id name archivedAt } }` and the team's
   `states`. Report any UUID that does not resolve; ask before overwriting with new ones.
6. Write `.linear/config.json` (2-space JSON, `chmod 600`, no secrets): `version`, `workspace`,
   `team_id`, `team_key`, `project_id`, `user_id` (viewer), `labels` and `states` name → UUID maps
   from `linear-issues/references/labels.md` and `states.md`. If `.linear/` cannot be created, use
   `~/.config/vendix-linear/config.json` and tell the user.
7. Confirm `.linear/config.json` is in `.gitignore` (it is today); append and warn if missing.
8. Smoke test: `issues(filter: { project: { id: { eq: "<PROJECT_ID>" } } }, first: 1)`.

## Output

1. First line: restart the terminal or `source ~/.zshrc` (omit if the key was already loaded).
2. Identity, team Quickss (QUI), project Vendix, counts of labels/states cached, `user_id` resolved.
3. Path of the config (no secrets) and the rc file used (0600).
4. One next step, e.g. "Di 'crea un bug en Vendix'".

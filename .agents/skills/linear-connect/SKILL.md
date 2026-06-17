---
name: linear-connect
description: |
  Bootstrap a developer's local Linear setup for the Vendix project on the
  Quickss workspace. Use when the user says "configurar Linear", "no tengo
  credenciales", "conectar a Linear", or when the `linear-issues` skill
  reports a missing `LINEAR_API_KEY` or absent `.linear/config.json`. Validates
  the personal API key, resolves and caches the team/project/labels/state
  UUIDs in `.linear/config.json`, and confirms with a smoke-test read. Do NOT
  use for creating or mutating issues (use `linear-issues` instead).
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Bootstrapping local Linear credentials for Vendix"
    - "Configuring the Vendix Linear API key"
    - "Resolving and caching Vendix team/project/labels UUIDs in .linear/config.json"
    - "Recovering from a missing or invalid LINEAR_API_KEY in the Vendix repo"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Linear Connect (Vendix · Quickss)

This skill exists because the `linear-issues` skill needs a personal API key
in the environment and a local cache of resolved UUIDs. This skill sets both
up. It is a **one-shot bootstrap** — run it once per developer per machine,
not on every issue creation.

## Inputs to collect

Ask the user only what is missing.

- **`LINEAR_API_KEY`** — Linear personal API key. Format: `lin_api_...`. The
  user pastes it once. **Never write it to any file inside the Vendix repo
  (including `.linear/config.json`), even with gitignore.** Store it in
  the user's shell environment only — see step 2 of the Procedure for the
  acceptable storage options.

The team, project, and workspace are all hardcoded to Quickss / Vendix. Do
not ask the user to choose — there is no choice to make.

## Procedure

1. **Check existing state**
   - `LINEAR_API_KEY` env var → if set, skip to step 3 (validation).
   - `.linear/config.json` at repo root → if exists, read it. Confirm the
     cached `team_id` and `project_id` match the constants below. If they
     do not, warn the user that the cache points to a different setup and
     ask whether to rebuild.

2. **Guide the user to generate a key**
   - URL for this workspace:
     `https://linear.app/quickss/settings/account/security/api-keys/new`
   - Label suggestion: `Vendix (Mavis on <hostname>)`
   - Scopes: default (full access to issues and projects the user can see).
     Avoid "Admin" scope.
   - The key is shown ONCE. Tell the user to copy it.
   - **Where the key MUST live** (read this carefully):
     - **In the shell env of the user's own machine.** Three acceptable
       options, in order of preference:
       1. **macOS Keychain** (most secure on macOS):
          `security add-generic-password -s linear-mavis -a $USER -w 'lin_api_...'`
          then load it in `~/.zshrc` with a `security find-generic-password`
          wrapper. Cifrado por el sistema, no aparece en texto plano en
          ningún archivo.
       2. **1Password / Bitwarden CLI** (best for teams that already use
          a password manager): `op read 'op://Private/Linear/api_key'` in
          `~/.zshrc`. Cifrado, auditable, portable entre máquinas.
       3. **Dotfile de shell privado** (acceptable, less secure):
          `echo 'export LINEAR_API_KEY="lin_api_..."' >> ~/.zshrc`.
          `chmod 600 ~/.zshrc`. Nunca commitees `~/.zshrc` a un repo de
          dotfiles público.
     - **Where the key MUST NOT live** (these are never acceptable, even
       if gitignored):
       - En `~/.linear/config.json` (es un archivo del repo y gitignore no
         es seguridad).
       - En un `.env` dentro del repo (gitignored no es seguridad — el
         archivo existe en disco, viaja en backups, en syncs de iCloud,
         en `git stash`, en `git reflog`).
       - En un dotfile de shell commiteado a un repo (aunque sea privado,
         una vez que sale de tu máquina ya perdiste control).
   - **Do the write yourself** (this is the agent, not the user — saving a
     click is part of the value). Concrete recipe for option 3 (the
     default; safest cross-platform, works on mac/linux/wsl):
     ```bash
     KEYFILE="$HOME/.zshrc"
     [ -f "$HOME/.bashrc" ] && [ ! -f "$KEYFILE" ] && KEYFILE="$HOME/.bashrc"
     LINE="export LINEAR_API_KEY=\"<key>\""
     if grep -q "^export LINEAR_API_KEY=" "$KEYFILE" 2>/dev/null; then
       echo "LINEAR_API_KEY ya estaba en $KEYFILE — no toco nada"
     else
       echo "$LINE" >> "$KEYFILE"
       chmod 600 "$KEYFILE"
       echo "LINEAR_API_KEY agregada a $KEYFILE (permiso 0600)"
     fi
     ```
     - Detect which shell rc file to use: prefer `~/.zshrc` on macOS
       (default since Catalina), fall back to `~/.bashrc` if `~/.zshrc`
       does not exist but `~/.bashrc` does.
     - If neither exists, fall back to the **current shell only** (export
       in the current process) and tell the user "for permanence, run
       `echo $LINE >> ~/.zshrc` yourself in a normal terminal".
     - If the user picked option 1 (Keychain) or 2 (1Password), do NOT
       run the recipe above. Instead, write the corresponding wrapper to
       the rc file and have it pull the key from the secure source.
     - **Never** log the appended line — it contains the raw key. Echo
       only the confirmation message above.
   - **Do NOT store the key in any file under the Vendix repo, including
     `.linear/config.json`.** The cache there contains only UUIDs and the
     user's own `user_id` — no secrets.

3. **Validate the key**
   - Run `viewer { id name email }` against `https://api.linear.app/graphql`.
   - If `errors` is non-empty → key is invalid/expired. Ask the user to
     re-generate.
   - If success → show the user which identity the workspace sees ("Conectado
     como `<name>` `<email>`"). This is a security check — if the identity is
     not theirs, STOP.

4. **Confirm the team and project exist**
   - The constants are baked into this skill:
     - `TEAM_ID = 64581e80-05a2-40e8-8acb-1f091ad38168` (Quickss, key QUI)
     - `PROJECT_ID = 0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59` (Vendix)
   - Run a quick `team(id: TEAM_ID) { id name key }` and
     `project(id: PROJECT_ID) { id name }` to confirm both still exist and
     that the user can see them. If either fails, surface the error — the
     user may have lost access.

5. **Discover labels and states (or use baked-in defaults)**
   - The expected labels and states for Vendix-on-Quickss are listed in
     step 6 below. To be safe, run a one-off discovery query against Linear
     and verify the cache matches reality. If the user has created new
     labels in Linear since the skill was last updated, surface them and ask
     the user whether to overwrite the cache.
   - Cache the user's own `viewer.id` as `user_id` so `linear-issues` can
     resolve "asignármelo a mí" without an extra query.

6. **Write `.linear/config.json`**
   - Location: `<repo-root>/.linear/config.json`.
   - Schema:
     ```json
     {
       "version": 1,
       "workspace": "quickss",
       "team_id": "64581e80-05a2-40e8-8acb-1f091ad38168",
       "team_key": "QUI",
       "project_id": "0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59",
       "user_id": "<uuid from viewer>",
       "labels": {
         "prod": "d6a4fc5c-7350-4cbf-b820-2fed8e6f131b",
         "dev": "a9523fa5-931b-40ce-99b1-320831d46e58",
         "IA": "b8d3e68a-9409-4b8e-b609-2eb4372f35bf",
         "Invesigacion": "c10a0a2e-f720-46ee-a743-1607c9c3a8ca",
         "Focus": "c3173485-3aca-418d-9ccc-4bb86a34f3d1",
         "Revisado": "de51cc7a-710d-461d-a38f-ccb98751e5d2"
       },
       "states": {
         "Backlog": "4b74cd22-2daa-4220-bccc-002a6b4121de",
         "Todo": "1c3e8e81-3fa4-46fa-9674-0d46e6bb003f",
         "In Progress": "e24cd9a7-66db-4e49-93cb-d3f1c99df2f7",
         "In Review": "d123e233-1f17-422e-b7c0-06f463e798df",
         "Done": "30f4c5c5-e1de-43a7-b00e-b737fc6e73a4",
         "Canceled": "6081e147-8c02-4531-9437-e9d6115559fd",
         "Duplicate": "226e301e-6078-4ebd-81b2-d0177d2683ac"
       }
     }
     ```
   - Pretty-print with 2-space indent. `chmod 600` the file (it contains
     UUIDs and the user's own user_id — not secrets, but dev-local).

7. **Update `.gitignore`**
   - Confirm `.linear/config.json` is in `.gitignore`. If not, append it.
   - This is already done at the repo level by the time the skill is in
     use, but verify and warn if it is missing.

8. **Smoke test**
   - Run a read against the API to confirm end-to-end:
     `issues(filter: { project: { id: { eq: "0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59" } } }, first: 1)`
   - Show the user the result.

## Output contract

A short summary printed to the user, in this order:

1. **Restart your terminal to load `LINEAR_API_KEY`** — the most important
   line, top of the message, easy to miss otherwise. The new export is in
   `~/.zshrc` (or `~/.bashrc`) but shells do not re-read rc files on the
   fly. The user must open a new terminal window, or run
   `source ~/.zshrc` (or `~/.bashrc`) in the current one, for `linear-issues`
   to find the env var.
2. Their Linear identity (name + email)
3. Team: Quickss (QUI)
4. Project: Vendix
5. Counts: 6 labels cached, 7 states cached, user_id resolved
6. Full path to `.linear/config.json` and a reminder that the cache
   contains no secrets
7. Confirmation that the API key was added to `~/.zshrc` (or whatever rc
   file was used), with permission `0600`
8. One example of what they can do next, e.g. "Di 'crea un issue en Vendix
   con label prod y prioridad alta'"

## Failure handling

- **No API key after step 2** → the user closed the terminal or did not
  paste. Re-ask. Do not skip validation.
- **Identity mismatch** (key works but the viewer is not the expected user)
  → STOP. The user may have pasted a teammate's key by mistake.
- **User insists on storing the key in the repo** (e.g. "ponlo en
  `.linear/config.json` y ya", "úsalo en un `.env` del proyecto") → REFUSE.
  Explain: gitignore is not a security boundary; the file still exists in
  the filesystem, in backups, in cloud syncs, and in git's reflog. The
  acceptable storage is the user's shell env (or Keychain / password
  manager). Re-offer step 2.
- **Team or project not visible** → the user may have lost access in Linear.
  Surface the error and ask them to confirm with the workspace admin.
- **`.linear/` creation fails** → fall back to
  `~/.config/vendix-linear/config.json` and update the path in the success
  message. The `linear-issues` skill should also be updated to look at the
  fallback path if the primary one is missing — for now, surface the
  divergence to the user.
- **`.gitignore` write fails** → still complete the config; warn the user
  to add `.linear/config.json` to gitignore manually before committing.

## Examples

### Example 1 — First-time setup

Input: "Quiero empezar a usar Linear desde el repo Vendix"

- Walks the user to
  `https://linear.app/quickss/settings/account/security/api-keys/new`
- User pastes `lin_api_...`
- **Agent appends the export line to `~/.zshrc` automatically** (with
  permission `0600`), using the recipe in step 2 — does not ask the user
  to copy-paste a command
- Validates the key with a `viewer` query
- Confirms Quickss team and Vendix project are visible
- Writes `.linear/config.json` with the baked-in constants, plus the
  resolved `user_id`
- Smoke test returns 0 issues (empty board) or N issues if the project
  already has work
- Output contract top line: "Reinicia tu terminal (o `source ~/.zshrc`)
  para que `LINEAR_API_KEY` esté disponible en el próximo comando"

### Example 2 — Key exists but config is missing

Input: "Tengo la API key en mi shell pero no hay config"

- Confirms `LINEAR_API_KEY` is set in the current shell
- Skips key generation and rc-file append, runs validation directly
- Resolves `user_id` and writes `.linear/config.json`
- Output contract skips the "restart terminal" line because the key is
  already loaded

### Example 3 — User has 1Password / wants Keychain

Input: "Tengo 1Password, configurálo con eso"

- Walks the user to store the key in 1Password under a "Linear" entry
- Writes the wrapper to `~/.zshrc` (NOT the raw key):
  ```bash
  export LINEAR_API_KEY="$(op read 'op://Private/Linear/api_key')"
  ```
- Validates by running `viewer` after `source ~/.zshrc`
- Output contract still leads with "restart your terminal"

---
name: linear-issues
description: >
  Create, search, list and update Vendix issues in Linear (Quickss/QUI/Vendix), user story first, plus pipeline labels.
  Trigger: crear issue/ticket/bug, buscar o listar issues de Vendix, leer un ticket.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Creating an issue in Linear"
    - "Creating a ticket in Linear"
    - "Creating a bug in Linear for Vendix"
    - "Searching for an existing Vendix issue in Linear"
    - "Checking if a Vendix Linear issue already exists"
    - "Listing Vendix issues in Linear"
    - "Updating the status of a Vendix Linear issue"
    - "Writing the Aprobado / Requiere cambios / Devuelto workflow labels on an issue"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Linear Issues (Vendix · Quickss)

Create, search, list and update issues in workspace Quickss, team QUI, project Vendix (hardcoded;
never ask for team/project). Owns **every** Linear write of the pipeline: `git-workflow`,
`pr-code-review` and `verify-ticket-prod` decide what to write and delegate here.
Missing `LINEAR_API_KEY` or `.linear/config.json` → STOP and run `linear-connect`
(`source scripts/load-linear-key.sh` loads the key without printing it).

## Reading a ticket

Before acting on any ticket (fix, verify, review), translate it into:
"Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>" + steps a person follows on screen
+ observable acceptance criteria. If the ticket lacks them, infer them, mark them as inferred, and
offer to add them to the issue.

## Actions

| User says | Action |
| --- | --- |
| "crear", "reportar", "nuevo", or describes a problem/task | `create` (bug if "bug/error/roto/no funciona/FIX", else feature/task; ask once if ambiguous) |
| "buscar", "existe", "hay un issue de" | `search`: `searchIssues`, filter to Vendix, relevance list with one-line "por qué coincide"; read-only |
| "listá", "abiertos" | `list`: `IssuesByProject`, open = `state.type` not completed/canceled/duplicate |
| update state / labels | `issueUpdate` (see Workflow labels) |

## Create

1. **Story first.** Collect the user story, then the rest of the template, **one question at a time**,
   restating the partial issue after each answer. Long free-form input: parse it into the template,
   show it, ask "¿Va así o ajusto algo?". Template and fields: `references/issue-template-bug.md`
   (bug and feature bodies; story → steps → criteria → technical notes).
2. **Title:** `FIX/` bugs (`^FIX/ .+( \[(admin|ecommerce|mobile|core|api|infra)\])?$`), `FEAT/`
   user-facing, `DEV/` internal, `CHORE/` small/deps. Sentence case, no period, ~60 chars. Propose
   corrections, never rewrite silently.
3. **Priority:** user value, else inferred from Severidad (Bloqueante 1, Alta 2, Media 3, Baja 4) and
   confirmed. Features default 3. State default `Todo`.
4. **Dedup (mandatory):** `searchIssues` before creating; on a likely match STOP and offer update /
   comment / create anyway / cancel. Detail: `references/dedup.md` (read on demand).
5. **Resolve IDs** from `.linear/config.json` (labels, states, `user_id`); "asignármelo" →
   `viewer { id }`. Unknown label/state → show the valid ones; never auto-create labels.
6. **Send** with variables, never interpolated:
   ```bash
   curl -sS https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" \
     -H "Content-Type: application/json" \
     -d "$(jq -n --arg q "$QUERY" --argjson v "$VARIABLES" '{query:$q, variables:$v}')"
   ```
   Linear returns 200 on GraphQL errors: check `errors`. Never print the key (max 4 chars).
7. **Output:** `QUI-x — title — URL` + what changed. Lists: `identifier — title — state — assignee`.
   No raw JSON.

Payloads: `references/graphql-mutations.md`. Catalogs: `references/states.md`, `references/labels.md`,
`references/priority-states.md`.

## Workflow labels (pipeline)

```
Backlog → Todo → In Progress → Code Review → In Review → Done
git-workflow RULE 9 (PR) → Code Review · pr-code-review → +Aprobado / +Requiere cambios (never state)
git-workflow RULE 10 (release develop→main) → In Review, clears the 3 labels
verify-ticket-prod → Done, or Todo + Devuelto + priority Alta (Urgent stays 1)
```

- `Aprobado` · `Requiere cambios` · `Devuelto` are **mutually exclusive**.
- `issueUpdate.labelIds` **replaces** the whole set: read current labels, drop the three workflow
  labels, add exactly one (none on release), send the union. A bare array wipes topic labels; appending
  stacks contradictory verdicts.
- **Read back after every workflow write:** a dead UUID fails with `Entity not found: IssueLabel`
  while the state change succeeds. Stale cache → `linear-connect`.
- Updating a duplicate: merge the description, union labels; never overwrite blindly.

## Failures

- Auth invalid / key missing → `linear-connect`. Corrupt config → back up to `.linear/config.json.bak`, `linear-connect`.
- Rate limit (429 / `RATE_LIMITED`) → wait 30 s, retry once, then surface.
- GraphQL validation error → show the message verbatim + one-line likely cause.

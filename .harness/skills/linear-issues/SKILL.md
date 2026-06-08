---
name: linear-issues
description: |
  Create and list issues in the Vendix project on the Quickss Linear workspace.
  Use when the user asks to "crear issue en Linear", "crear ticket", "listar
  issues de Vendix", "crear bug en Vendix", or describes a task that should
  become a Vendix issue. Operates ONLY against the Quickss workspace, team
  "Quickss" (key QUI), and project "Vendix" — hardcoded, not configurable.
  Do NOT use for editing the workspace, managing teams/projects, or working
  with a different Linear workspace.
---

# Linear Issues (Vendix · Quickss)

## Inputs to collect

Before calling Linear, confirm what is missing. Do NOT ask for team or
project — both are hardcoded to Quickss / Vendix.

For the **`create`** action, what the agent must collect depends on whether
the issue is a **bug** or a **feature/task**. The full bug workflow is below;
feature/task workflows use a lighter set (title, description, priority,
assignee, labels).

### Action-specific: `create` (BUG)

For bugs the agent MUST collect all of the following before calling Linear.
Use `references/issue-template-bug.md` as the source of truth for the
description body; do not deviate from the section order.

**Required from the user — collect one by one, never assume:**

1. **What is broken?** — one sentence in the user's own words. Used to
   validate the title; the agent reformulates into the `FIX/` format.
2. **App / module** — `admin`, `ecommerce`, `mobile`, `core`, `api`, or
   `infra`. Drives the `[<module>]` tag in the title.
3. **Store** — name or NIT. Required for reproduction; goes in `Entorno`.
4. **Date of observation** — defaults to today if the user does not specify.
5. **Pasos para reproducir** — numbered list, minimum 2 steps. If the user
   gives prose, the agent reformulates into a numbered list and confirms.
6. **Comportamiento actual** — what happens now, including any error
   message verbatim. Ask the user to paste the error text or screenshot
   link if they have not.
7. **Comportamiento esperado** — what should happen.
8. **Severidad** — exactly one of:
   `Bloqueante` (no se puede operar),
   `Alta` (workaround incómodo),
   `Media` (workaround existe),
   `Baja` (cosmético).
9. **Capturas / logs** — URLs, pasted text, or "n/a".
10. **Priority** (numeric) — if the user gives one, use it. Otherwise the
    agent MUST infer it from Severidad (see table in
    `references/issue-template-bug.md`) and confirm with the user.
11. **Assignee** — "me", an email, or "unassigned" (default = unassigned).
12. **Labels** — must be one of the six existing labels (see
    `references/labels.md`); if the user wants a new one, tell them to
    create it in Linear first.

**Questioning protocol — the agent MUST follow this loop:**

- Ask **one** question at a time when answers are short (e.g. "Bloqueante,
  Alta, Media o Baja?"). Do not bombard the user with all 12 fields at once.
- After each answer, restate the partial issue in a single short summary
  line so the user can correct course.
- If the user gives a long, free-form description, parse it into the
  template sections, show the parsed result, and ask: "¿Va así o ajusto
  algo?" before creating.
- If a required field is genuinely missing and the user refuses to provide
  it, create the issue with `priority: 0` and the field filled with `n/a` —
  never block creation on missing info.
- Never invent store names, NITs, error messages, or repro steps. If
  something is unknown, write `n/a` and tell the user.

**Title validation — the agent MUST enforce this:**

- The title must match `^FIX/ .+ \[(admin|ecommerce|mobile|core|api|infra)\]$`
  OR `^FIX/ .+$` (module tag optional but recommended).
- If the user's input does not match, propose a corrected title and ask for
  confirmation. Do not silently rewrite.

### Action-specific: `create` (FEATURE / TASK)

For non-bug issues the agent collects a lighter set:

- **Title** — sentence-case imperative. Optional prefix `FEAT/`, `DEV/`, or
  `CHORE/` is encouraged; the agent proposes one if the user does not give
  it.
- **Description** — free-form markdown. The agent does not enforce a
  template.
- **Priority** — asked, or defaults to 3 (medium).
- **Assignee / Labels** — same rules as for bugs.

### Action-specific: `list`

- **Filter** — open vs. all. State name (e.g. "In Progress", "Todo"). If
  the user says "abiertos", filter `state.type != "completed"`.

### General inputs (all actions)

- **Action**: `create` (default if the user says "crear") or `list`
- **State** (optional, for `create`): defaults to "Todo"; must be one of
  the seven existing states (see `references/states.md`)

If `LINEAR_API_KEY` is not set or `.linear/config.json` is missing, STOP
and invoke the `linear-connect` skill. Do not try to bootstrap credentials
here.

## Title conventions (reference)

Linear title format used by the Quickss team:

| Prefix | Use for | Examples seen in production |
|---|---|---|
| `FIX/` | Bug / broken behavior | `FIX/ Error al finalizar compra [ecommerce]` |
| `FEAT/` | New user-facing feature | `FEAT/ Descargar plantilla con productos [admin]` |
| `DEV/` | Internal dev work, refactor, infra | `DEV/ Migrar módulo de horarios a Signals` |
| `CHORE/` | Tiny tasks, deps, cleanup, config | `CHORE/ Bump typescript to 5.4` |
| (none) | Module / epic / non-code work | `Modulos Core: Gestion de documentos soporte` |

Rules:

- Title case for the prefix (`FIX/`, not `fix/`)
- Single space after the slash
- Sentence case for the description (only first word capitalized)
- No trailing period
- Optional `[<module>]` tag at the end (no space inside brackets)
- Maximum ~60 characters total

## Procedure

1. **Verify environment**
   - `LINEAR_API_KEY` env var must be set. If not → trigger `linear-connect`.
   - `.linear/config.json` at repo root must exist. If not → trigger
     `linear-connect`.

2. **Classify the request**
   - If the user said "bug", "error", "roto", "no funciona", "FIX" → bug
     workflow (see above).
   - Otherwise → feature/task workflow.
   - If ambiguous, ask once: "¿Es un bug que querés reportar o una
     feature/tarea nueva?"

3. **Collect required info (bug workflow)**
   - Walk the 12 questions in the order above, one at a time.
   - Build the description body from `references/issue-template-bug.md`
     using the user's answers.
   - Validate the title format. Propose a correction if it does not match.
   - Show the full assembled issue (title + description + metadata) and
     ask for confirmation before creating.

4. **Resolve IDs from cache**
   - Read `.linear/config.json` (it lives at the repo root, not inside
     `.harness/`).
   - Look up label names → UUIDs using the `labels` map.
   - Look up state names → UUIDs using the `states` map.
   - If the user said "asignármelo a mí" or gave an email, resolve the
     assigneeId via a `viewer { id }` query (cache it in `user_id` next
     time).

5. **Build the GraphQL request**
   - For `create`: use the `issueCreate` mutation. Payload shape in
     `references/graphql-mutations.md`. The required IDs are baked into
     the skill and should be passed as variables, not interpolated into
     the query string.
   - For `list`: use the `IssuesByProject` query in
     `references/graphql-mutations.md`, filtering by `project.id` (Vendix).
   - Construct the request body as `{"query": "...", "variables": {...}}`.

6. **Send the request**
   ```bash
   curl -sS https://api.linear.app/graphql \
     -H "Authorization: $LINEAR_API_KEY" \
     -H "Content-Type: application/json" \
     -d @<(jq -n --arg q "$QUERY" --argjson v "$VARIABLES" \
         '{query: $q, variables: $v}')
   ```
   - Capture stdout. Non-2xx HTTP or `"errors":[...]` in the body is a
     failure (Linear returns 200 even on GraphQL errors).
   - Never print or log the API key. If debugging auth, print only the
     first 4 characters.

7. **Surface the result**
   - On success: show the identifier (e.g. `QUI-12`), title, URL
     (`https://linear.app/quickss/issue/QUI-12`), and what changed.
   - On failure: show the Linear error message verbatim, then a one-line
     hint about the likely cause (auth, validation, rate limit, label not
     found).

## Output contract

A short user-facing message containing:

- The issue identifier(s) affected (e.g. `QUI-12`)
- A clickable URL (`https://linear.app/quickss/issue/QUI-12`)
- A summary of what changed
- For `list` actions: a compact bullet list of `identifier — title —
  state — assignee`

Do NOT dump raw GraphQL responses. The user wants a confirmation, not JSON.

## Failure handling

- **`LINEAR_API_KEY` missing or invalid** → tell the user the symptom,
  then trigger `linear-connect`. Do not attempt to fix credentials here.
- **Label name not in cache** → tell the user the six valid labels (see
  `references/labels.md`) and ask which to use, or to create a new one
  in Linear first. Do not auto-create labels.
- **State name not in cache** → same pattern; show the seven valid states
  from `references/states.md`.
- **GraphQL validation error** → show the message; the user needs to fix
  the input.
- **Rate limit** (HTTP 429 or `extensions.code: RATE_LIMITED`) → wait 30s
  and retry once. If still failing, surface to the user.
- **`.linear/config.json` corrupted** → back it up to
  `.linear/config.json.bak` and trigger `linear-connect` to rebuild.
- **Title does not match the `FIX/` format** → do NOT auto-correct;
  propose a correction and wait for confirmation.
- **Missing required bug fields** → do NOT silently fill with `n/a`;
  either ask once more or create with `priority: 0` and explicit
  `n/a` markers, and tell the user what was missing.

## Examples

### Example 1 — Create a bug (full workflow)

Input: "Crear issue 'bug al aprobar reseña' prioridad alta con label prod,
asignármelo"

Agent behavior:

1. Classifies as bug (keyword: "bug").
2. Asks: "¿En qué app / módulo?" → "ecommerce".
3. Asks: "¿En qué store?" → "Vendix Demo Store".
4. Asks: "¿Cuándo lo viste?" → defaults to today.
5. Asks: "¿Pasos para reproducir?" → parses into a numbered list.
6. Asks: "¿Qué pasa ahora?" → user pastes the error.
7. Asks: "¿Qué debería pasar?" → "La reseña se aprueba con toast de OK".
8. Asks: "Severidad — Bloqueante, Alta, Media o Baja?" → "Alta".
9. Asks: "¿Capturas o logs?" → user pastes Sentry URL.
10. Priority: user said "alta" → 2. Confirmed with user.
11. Assignee: "asignármelo" → resolves to `viewer.id`.
12. Labels: "prod" → resolves to `d6a4fc5c-7350-4cbf-b820-2fed8e6f131b`.
13. Builds title: `FIX/ Error al aprobar reseña [ecommerce]`. Confirms.
14. Sends `issueCreate` with the assembled description body from
    `references/issue-template-bug.md`.
15. Returns: `Created QUI-424 — FIX/ Error al aprobar reseña [ecommerce]
    — https://linear.app/quickss/issue/QUI-424`.

### Example 2 — List open Vendix issues

Input: "Lista los issues abiertos de Vendix"

- Sends `IssuesByProject` with state filter
  `{ type: { neq: "completed" } }`
- Returns a bullet list of `identifier — title — state — assignee`

## Reference

- GraphQL payloads: see `references/graphql-mutations.md`
- Bug template (full): see `references/issue-template-bug.md`
- Labels catalog: see `references/labels.md`
- States catalog: see `references/states.md`

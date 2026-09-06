---
name: linear-issues
description: |
  Create, search, and list issues in the Vendix project on the Quickss Linear
  workspace. Use when the user asks to "crear issue en Linear", "crear ticket",
  "buscar issue", "¿existe un issue de...?", "listar issues de Vendix", "crear
  bug en Vendix", or describes a task that should become a Vendix issue.
  Operates ONLY against the Quickss workspace, team "Quickss" (key QUI), and
  project "Vendix" — hardcoded, not configurable. Do NOT use for editing the
  workspace, managing teams/projects, or working with a different Linear
  workspace.
license: MIT
metadata:
  author: rzyfront
  version: "1.3"
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
12. **Labels** — must be one of the eight existing labels (see
    `references/labels.md`); if the user wants a new one, tell them to
    create it in Linear first. Note that `Aprobado`, `Requiere cambios` and
    `Devuelto` are **workflow labels** written by the pipeline skills, not
    something a human picks at creation time — see **Workflow labels** below.

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

### Action-specific: `search`

Use when the user wants to **find** an existing issue by meaning/topic, not
create one and not just list — e.g. "buscá el issue de X", "¿hay un ticket
sobre Y?", "¿existe un bug de Z?".

- **Term** (required) — the free-text the user is looking for. If the user
  only gives a vague topic, ask once for the key words. Do not invent terms.
- **Scope** — always the Vendix project (filter results client-side by
  `project.id`).
- **State filter** (optional) — if the user says "abiertos" / "cerrados",
  apply the same `state.type` filter as `list` after searching.
- **State tiering** (optional, used by `pr-code-review`) — when the caller
  needs candidates ranked by pipeline state rather than pure relevance, make
  **one** `searchIssues` call and re-rank the returned nodes client-side.
  `searchIssues` has **no state filter argument**; it returns
  `state { name type }` on every node, and it is rate-limited to 30 req/min,
  so never fan out one query per state. Recipe:
  `references/graphql-mutations.md` → "Tiered match".

`search` differs from `list`: `list` is a structured filter (by state),
`search` is a relevance match by text/meaning via `searchIssues`. If you need
a hard state filter *and* no relevance ranking, that is `list`
(`issues(filter: { state: { name: { eq: "Code Review" } } })`), not `search`.

### General inputs (all actions)

- **Action**: `create` (default if the user says "crear"), `list`, or
  `search` (if the user says "buscar", "existe", "hay un issue/ticket de")
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

## Workflow labels and the Vendix pipeline

This skill owns **every** Linear write in the Vendix pipeline — `git-workflow`,
`pr-code-review` and `verify-ticket-prod` all delegate here instead of calling
the API themselves. Those three skills decide *what* to write; this one is
responsible for writing it *correctly*.

### The pipeline

```
Backlog → Todo → In Progress → Code Review → In Review → Done
                                    │  ▲          │         ▲
                        +Aprobado / │  │          │         │ QA OK
                 +Requiere cambios ─┘  │          │         │
                                       │          │
   git-workflow R9 ────────────────────┘          │
   (abrir PR)                                     │
   pr-code-review ── labels only, NEVER estado    │
   git-workflow R10 (release develop→main) ───────────┘  limpia las 3 labels
   verify-ticket-prod ── Done, o Todo +Devuelto +prioridad Alta
```

Full trigger table in `references/states.md`.

### The three workflow labels are mutually exclusive

`Aprobado` · `Requiere cambios` · `Devuelto` are three answers to one question:
*what did the last reviewer decide?* An issue must never carry two at once — a
leftover one contradicts the current truth.

**Linear's `issueUpdate.labelIds` REPLACES the entire label set.** It does not
append. Two failure modes follow, and both are silent:

1. Sending a bare `[verdict]` array **wipes** the ticket's topic labels
   (`Bug`, `Feature`, `IA`, `Invesigacion`, `Improvement`).
2. Sending `[...current, verdict]` **stacks** contradictory verdicts.

The correct write reads first, then strips, then adds:

```js
const WORKFLOW_LABELS = [
  'c41a06ad-bc03-4baf-a36a-93df6230054b', // Aprobado
  '1b0a8cac-be15-4aaf-9e68-ba9f86f57574', // Requiere cambios
  'dbdfcb7c-af6f-49bb-825f-3f38f9df218e', // Devuelto
]
// read current, drop every workflow label, add exactly one (or none on release)
const labelIds = [...current.filter(id => !WORKFLOW_LABELS.includes(id)), verdict]
```

```graphql
query { issue(id: "QUI-XXX") { labels { nodes { id name } } } }
```

**Release clears all three and adds none** — a ticket in `In Review` carries no
workflow label.

### Always read back after a workflow write

A dead label UUID fails with `Entity not found: IssueLabel` **without aborting
the rest of the mutation**: the state moves, the label never lands, and the
agent reports success. Read the issue back and confirm both the state and the
label before telling the user it worked.

## Procedure

1. **Verify environment**
   - `LINEAR_API_KEY` env var must be set. If not → trigger `linear-connect`.
   - `.linear/config.json` at repo root must exist. If not → trigger
     `linear-connect`.

2. **Classify the action, then the request**
   - First pick the action:
     - "buscar", "existe", "hay un issue/ticket de", "encontrá" → `search`
       (jump to step 4b below; skip create/dedup).
     - "listá", "mostrá los issues", "abiertos" → `list`.
     - "crear", "reportar", "nuevo" (or a described problem/task) → `create`.
   - For `create`, classify the request type:
     - "bug", "error", "roto", "no funciona", "FIX" → bug workflow.
     - Otherwise → feature/task workflow.
     - If ambiguous, ask once: "¿Es un bug que querés reportar o una
       feature/tarea nueva?"

3. **Collect required info (bug workflow)**
   - Walk the 12 questions in the order above, one at a time.
   - Build the description body from `references/issue-template-bug.md`
     using the user's answers.
   - Validate the title format. Propose a correction if it does not match.

4. **Deduplication check (create only — run BEFORE creating)**
   - This step is MANDATORY for `create` and runs right after the title +
     purpose are assembled, before the final create. See the dedicated
     section "Deduplication check (before create)" below for the full rules.
   - Run `searchIssues` (see `references/graphql-mutations.md`) with the
     salient keywords of the new issue.
   - Judge each candidate for purpose overlap (same purpose, or ~70%+
     coincidence/relation). Filter to the Vendix project.
   - **If one or more likely duplicates are found:** STOP, show them to the
     user, and offer the four options (update / comment / create anyway /
     cancel). Do not create until the user picks.
   - **If none are found (or the search fails):** show the full assembled
     issue (title + description + metadata), ask for confirmation, and
     continue to create.

   **4b. Search action (`search` only — terminal path)**
   - Build a `term` from the user's words (key nouns; drop filler).
   - Call `searchIssues(term, teamId)` (see `references/graphql-mutations.md`)
     and filter the nodes client-side to `project.id` == Vendix.
   - Apply the optional `state.type` filter if the user asked for
     open/closed.
   - Surface the matches as a compact list (see Output contract); for each,
     add a one-line "por qué coincide". If nothing matches, say so and offer
     to create one (route to `create`). This path does NOT create or modify
     anything — skip steps 5–7 and go straight to surfacing the result.

5. **Resolve IDs from cache**
   - Read `.linear/config.json` (it lives at the repo root, not inside
     `.harness/`).
   - Look up label names → UUIDs using the `labels` map.
   - Look up state names → UUIDs using the `states` map.
   - If the user said "asignármelo a mí" or gave an email, resolve the
     assigneeId via a `viewer { id }` query (cache it in `user_id` next
     time).

6. **Build the GraphQL request**
   - For `create`: use the `issueCreate` mutation. Payload shape in
     `references/graphql-mutations.md`. The required IDs are baked into
     the skill and should be passed as variables, not interpolated into
     the query string.
   - For `update` (user chose to update a duplicate): use the `issueUpdate`
     mutation with the existing issue's UUID and only the fields that
     change. Merge — do not blindly overwrite the description; pass the
     union of labels. If the write touches a **workflow label**, apply the
     mutual-exclusivity rule in **Workflow labels** below.
   - For `comment` (user chose to append to a duplicate): use the
     `commentCreate` mutation with the existing issue's UUID and the new
     info as the comment body.
   - For `list`: use the `IssuesByProject` query in
     `references/graphql-mutations.md`, filtering by `project.id` (Vendix).
   - For `search`: use the `searchIssues` query (handled in step 4b).
   - Construct the request body as `{"query": "...", "variables": {...}}`.

7. **Send the request**
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

8. **Surface the result**
   - On success: show the identifier (e.g. `QUI-12`), title, URL
     (`https://linear.app/quickss/issue/QUI-12`), and what changed
     (created / updated / commented).
   - On failure: show the Linear error message verbatim, then a one-line
     hint about the likely cause (auth, validation, rate limit, label not
     found).

## Deduplication check (before create)

**Goal:** never create a second issue for a problem/feature that already has
one. Before every `create`, the agent MUST search existing Vendix issues and,
if a likely duplicate exists, surface it and let the user decide — never
create silently on top of a duplicate, and never auto-update without asking.

### When it runs

- `create` action only (both bug and feature/task workflows).
- After the title + purpose are assembled, before the final create.
- Skip only if the user explicitly says "ya sé que no existe, créalo igual" —
  and even then, note that the check was skipped.

### How to search

1. Build a `term` from the salient keywords of the new issue: the title minus
   its `FIX/`/`FEAT/`/`DEV/`/`CHORE/` prefix, the module tag, and the key
   nouns from the "what is broken" / purpose answer. Do not send the full
   template body.
2. Call `searchIssues(term, teamId)` (see `references/graphql-mutations.md`).
   It uses full-text + vector ranking, so it matches by meaning, not just
   exact substring.
3. Filter the returned nodes client-side to `project.id` == Vendix
   (`0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59`).
4. Keep the top candidates (≈ first 5 after filtering).

### How to judge a match (purpose / ~70% coincidence or relation)

This is a **semantic** judgment, not a string-similarity number. Treat a
candidate as a likely duplicate or strong relation when it shares the
**purpose** with the new issue — i.e. roughly 70%+ overlap of intent. Strong
signals:

- **Same module/area** (`[admin]`, `[ecommerce]`, …) AND same feature or
  broken behavior.
- Describes the **same underlying problem or feature**, even if worded
  differently (synonyms, different store, different repro path).
- Same error message / symptom / endpoint.

Weaker signals (mention as "related", not "duplicate"): same module but a
different concern, or same feature but a clearly different sub-task.

Consider `state.type`:

- A match in an **open** state → true duplicate; updating it is usually best.
- A match in **completed/canceled** → possible **regression**; offer to
  reopen/update it or create a new issue that references it.

### What to present

If one or more matches are found, STOP and show a compact list:

```
Encontré issue(s) que podrían ser el mismo o estar muy relacionados:

1. QUI-418 — FIX/ Error al aprobar reseña [ecommerce] — In Progress
   https://linear.app/quickss/issue/QUI-418
   Por qué: mismo módulo (ecommerce) y mismo flujo de aprobación de reseña.
```

Then offer **exactly these four options** and wait for the user's choice:

| Option | Action | When it fits |
| --- | --- | --- |
| **1. Actualizar el existente** | `issueUpdate` on the matched issue UUID with the new data (merge description, union labels, bump priority if higher). | Same issue, still open, new info refines it. |
| **2. Comentar en el existente** | `commentCreate` on the matched issue UUID with the new repro/context as a comment. | Want to add detail/repro without changing the issue's fields. |
| **3. Crear uno nuevo igual** | Proceed with `issueCreate` as originally planned. | Genuinely distinct, or a regression you want tracked separately. |
| **4. Cancelar** | Do nothing. | User wants to rethink. |

### Rules

- Never auto-pick an option. The user decides every time.
- If `searchIssues` fails, is rate-limited, or returns nothing, do **not**
  block: tell the user "no se pudo verificar duplicados" (or "no encontré
  duplicados") and continue to the normal create confirmation.
- For option 1, never blindly overwrite the description — merge, and pass the
  union of old + new labels (Linear's `labelIds` replaces the whole set).

## Output contract

A short user-facing message containing:

- The issue identifier(s) affected (e.g. `QUI-12`)
- A clickable URL (`https://linear.app/quickss/issue/QUI-12`)
- A summary of what changed
- For `list` actions: a compact bullet list of `identifier — title —
  state — assignee`
- For `search` actions: a compact bullet list of `identifier — title —
  state — url`, ordered by relevance, each with a one-line "por qué
  coincide". If nothing matches, say so and offer to create one.

Do NOT dump raw GraphQL responses. The user wants a confirmation, not JSON.

## Failure handling

- **`LINEAR_API_KEY` missing or invalid** → tell the user the symptom,
  then trigger `linear-connect`. Do not attempt to fix credentials here.
- **Label name not in cache** → tell the user the eight valid labels (see
  `references/labels.md`) and ask which to use, or to create a new one
  in Linear first. Do not auto-create labels.
- **State name not in cache** → same pattern; show the eight valid states
  from `references/states.md`.
- **`Entity not found: IssueLabel` / `Entity not found: WorkflowState`** →
  the cached UUID is dead: the label or state was renamed away, archived, or
  deleted in the Linear UI. **This error does not abort the rest of the
  mutation** — the state change can succeed while the label silently never
  lands. Never report success without reading the issue back. Re-resolve the
  cache with `linear-connect` and tell the user which entry was stale.
- **GraphQL validation error** → show the message; the user needs to fix
  the input.
- **Rate limit** (HTTP 429 or `extensions.code: RATE_LIMITED`) → wait 30s
  and retry once. If still failing, surface to the user.
- **`.linear/config.json` corrupted** → back it up to
  `.linear/config.json.bak` and trigger `linear-connect` to rebuild.
- **Title does not match the `FIX/` format** → do NOT auto-correct;
  propose a correction and wait for confirmation.
- **`searchIssues` fails / rate-limited / empty (dedup)** → never block
  creation. Tell the user dedup could not run (or found nothing) and
  continue to the normal create confirmation. See "Deduplication check".
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
12. Labels: "Bug" → resolves to `cc489b0b-2b1e-4d58-92de-8c261f74b67e`.
13. Builds title: `FIX/ Error al aprobar reseña [ecommerce]`. Confirms.
14. **Deduplication check**: runs `searchIssues`, finds no Vendix match,
    shows the assembled issue, and asks for confirmation.
15. Sends `issueCreate` with the assembled description body from
    `references/issue-template-bug.md`.
16. Returns: `Created QUI-424 — FIX/ Error al aprobar reseña [ecommerce]
    — https://linear.app/quickss/issue/QUI-424`.

### Example 2 — List open Vendix issues

Input: "Lista los issues abiertos de Vendix"

- Sends `IssuesByProject` with state filter
  `{ type: { neq: "completed" } }`
- Returns a bullet list of `identifier — title — state — assignee`

### Example 3 — Duplicate detected before create

Input: "Crear bug: al aprobar una reseña en ecommerce el server tira 500"

Agent behavior:

1. Classifies as bug, collects the required fields, assembles the title
   `FIX/ Error al aprobar reseña [ecommerce]`.
2. **Deduplication check**: calls `searchIssues` with
   `term: "error aprobar reseña ecommerce 500"`, filters to Vendix.
3. Finds `QUI-418 — FIX/ Error al aprobar reseña [ecommerce] — In Progress`,
   judges it the same purpose (same module + same approval flow).
4. STOPS and shows the match, then asks:
   "¿Actualizar QUI-418, comentar en él, crear uno nuevo igual, o cancelar?"
5. User picks "comentar" → agent sends `commentCreate` on QUI-418's UUID
   with the new repro + 500 trace as the comment body.
6. Returns: `Comenté en QUI-418 — FIX/ Error al aprobar reseña [ecommerce]
   — https://linear.app/quickss/issue/QUI-418` (no new issue created).

### Example 4 — Search for an existing issue

Input: "¿Hay algún issue sobre el checkout de ecommerce?"

- Classifies the action as `search` (keyword "hay algún issue").
- Builds `term: "checkout ecommerce"` and calls `searchIssues`, filtering to
  the Vendix project.
- Returns a relevance-ordered bullet list, e.g.:
  - `QUI-402 — FIX/ Error al finalizar compra [ecommerce] — In Progress —
    https://linear.app/quickss/issue/QUI-402` · por qué: mismo flujo de
    checkout en ecommerce.
- If nothing matches: "No encontré issues sobre eso. ¿Querés que cree uno?"
  (routes to `create`). Nothing is created or modified in this path.

## Reference

- GraphQL payloads: see `references/graphql-mutations.md`
- Bug template (full): see `references/issue-template-bug.md`
- Labels catalog: see `references/labels.md`
- States catalog: see `references/states.md`

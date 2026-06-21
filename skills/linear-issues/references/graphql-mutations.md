# GraphQL Mutations — Vendix on Quickss

All requests go to `https://api.linear.app/graphql` with header
`Authorization: $LINEAR_API_KEY` (no `Bearer` prefix — Linear uses the raw
key for personal API keys).

## Constants (do not change unless the workspace is renamed)

```text
WORKSPACE  quickss
TEAM_ID    64581e80-05a2-40e8-8acb-1f091ad38168   # Quickss (key QUI)
PROJECT_ID 0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59   # Vendix
```

These are baked into the skill because Vendix has a single client (Quickss)
on a single team. If Quickss ever creates a second team, this file and the
parent skill need to be revisited.

## Important typing note

Linear's GraphQL schema is inconsistent about `ID!` vs `String!`. In practice:

- **Filter inputs** like `filter: { id: { eq: $x } }` want `ID!`
- **Direct arguments** like `team(id: $x)` want `String!`

If a query uses both (e.g. filtering labels by team AND fetching the team
itself), declare two variables of different types and pass the same UUID
value to each.

## Create issue

```graphql
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      title
      url
      priority
      state { name }
      assignee { name email }
      labels { nodes { name } }
    }
  }
}
```

Variables:

```json
{
  "input": {
    "teamId": "64581e80-05a2-40e8-8acb-1f091ad38168",
    "projectId": "0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59",
    "title": "Bug en checkout mobile",
    "description": "## Pasos para reproducir\n1. ...",
    "priority": 2,
    "labelIds": ["d6a4fc5c-7350-4cbf-b820-2fed8e6f131b"],
    "assigneeId": "<uuid>",
    "stateId": "<uuid>"
  }
}
```

`description` accepts Markdown. The mutation returns `success: false` (not an
exception) if any ID is invalid — check this before reading `issue`.

## Update issue (for the "update existing" dedup option)

Used when the deduplication check finds a real duplicate and the user chooses
to update it instead of creating a new one. The `id` is the issue **UUID**
(not the `QUI-12` identifier) — resolve it from the `searchIssues` result
(`id` field) or via `issues(filter: { identifier: { eq: "QUI-12" } })`.

```graphql
mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue {
      id
      identifier
      title
      url
      priority
      state { name }
      labels { nodes { name } }
    }
  }
}
```

Variables (only include the fields the user actually wants to change):

```json
{
  "id": "<issue-uuid>",
  "input": {
    "title": "FIX/ Error al aprobar reseña [ecommerce]",
    "description": "...merged markdown body...",
    "priority": 2,
    "labelIds": ["d6a4fc5c-7350-4cbf-b820-2fed8e6f131b"]
  }
}
```

- **Do not blindly overwrite** the existing `description`. Either merge the new
  info into the existing body or prefer the **comment** option below to append
  context without losing history.
- `labelIds` **replaces** the full label set — pass the union of old + new
  labels, not just the new one, or labels will be dropped.
- Returns `success: false` (not an exception) if the `id` or any input ID is
  invalid — check it before reading `issue`.

## End-to-end example — bug (FIX/) with full template

This is what the agent sends for a fully-collected bug. The description
body comes verbatim from `references/issue-template-bug.md`.

**Variables:**

```json
{
  "input": {
    "teamId": "64581e80-05a2-40e8-8acb-1f091ad38168",
    "projectId": "0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59",
    "title": "FIX/ Error al aprobar reseña desde ecommerce [ecommerce]",
    "description": "## Entorno\n- **App:** ecommerce\n- **Store:** Vendix Demo Store (NIT 900123456)\n- **Fecha:** 2026-06-08\n\n## Pasos para reproducir\n1. Ingresar al panel admin como moderador\n2. Ir a la sección Reseñas pendientes\n3. Hacer clic en \"Aprobar\" sobre una reseña\n4. Observar la respuesta del servidor\n\n## Comportamiento actual\nEl endpoint devuelve 500 Internal Server Error. En consola del navegador:\n```\nTypeError: Cannot read properties of undefined (reading 'id')\n    at ReviewController.approve (review.controller.ts:127)\n```\n\n## Comportamiento esperado\nLa reseña se marca como aprobada, desaparece de pendientes y aparece en la lista de aprobadas con un toast de confirmación.\n\n## Capturas / logs\nhttps://drive.example.com/screenshots/2026-06-08-review-500.png\nSentry: VENDIX-REVIEW-7421\n\n## Severidad\n- [x] Alta (workaround incómodo)\n- [ ] Bloqueante (no se puede operar)\n- [ ] Media (workaround existe)\n- [ ] Baja (cosmético)\n",
    "priority": 2,
    "labelIds": ["d6a4fc5c-7350-4cbf-b820-2fed8e6f131b"],
    "assigneeId": "<uuid-from-viewer-query>",
    "stateId": "<uuid-of-Todo-state>"
  }
}
```

**Notes for the agent:**

- The `description` value is one large JSON string with `\n` for newlines.
  Do not pretty-print it before sending — Linear accepts raw newlines fine
  and pretty-printing risks breaking the markdown.
- The `priority: 2` was inferred from "Alta" via the table in
  `references/issue-template-bug.md`.
- The `labelIds` array may be empty `[]` if the user did not pick any label.
- `assigneeId` may be omitted entirely if unassigned.

## List issues (project-scoped)

```graphql
query IssuesByProject(
  $projectId: ID!,
  $stateTypeNe: String
) {
  issues(
    filter: {
      project: { id: { eq: $projectId } }
      state: { type: { neq: $stateTypeNe } }
    }
    first: 50
    orderBy: updatedAt
  ) {
    nodes {
      identifier
      title
      url
      priority
      state { name }
      assignee { name }
      updatedAt
    }
  }
}
```

Variables for "open issues only":

```json
{ "projectId": "0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59", "stateTypeNe": "completed" }
```

Variables for "everything":

```json
{ "projectId": "0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59", "stateTypeNe": null }
```

Skip pagination unless the user asks for more than 50.

## Search issues (`search` action AND dedup before create)

`searchIssues` runs Linear's full-text + vector search ranked by relevance.
This is the right tool for both the user-facing `search` action ("¿hay un
issue de X?") and the dedup check before create ("is there already an issue
with the same purpose?") — it matches by meaning, not just exact title
substring. It is **rate-limited to 30 requests/min** — one call per
search/create is fine.

```graphql
query SearchIssues($term: String!, $teamId: String) {
  searchIssues(term: $term, teamId: $teamId, first: 10) {
    nodes {
      id
      identifier
      title
      url
      priority
      description
      createdAt
      updatedAt
      state { name type }
      assignee { name }
      project { id name }
      labels { nodes { name } }
    }
    totalCount
  }
}
```

Variables:

```json
{
  "term": "error aprobar reseña ecommerce",
  "teamId": "64581e80-05a2-40e8-8acb-1f091ad38168"
}
```

**Notes for the agent:**

- `term` should be the salient keywords of the new issue: the title minus its
  `FIX/`/`FEAT/` prefix, plus the module tag and the key nouns from the "what
  is broken" / purpose answer. Do **not** send the full template body.
- `teamId` is the Quickss team — it **boosts** that team's results but does not
  restrict to it. Since Vendix is the only project on this team, results are
  effectively Vendix already.
- Still **filter the returned `nodes` client-side** to `project.id ==
  PROJECT_ID` (`0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59`) before showing matches —
  belt and suspenders.
- `state.type` matters for judging: a match in `completed`/`canceled` is a
  possible **regression** (offer to reopen/update or create-new-referencing),
  not a plain duplicate.
- `id` (UUID) from a node feeds `issueUpdate` / `commentCreate` directly.

## Resolve current user

For "asignármelo a mí":

```graphql
query Viewer { viewer { id name email } }
```

The result is a good candidate to cache in `.linear/config.json` under
`user_id` (this skill does not write the config itself — that is
`linear-connect`'s job, but a follow-up call here is fine for one-off use).

## Add comment

```graphql
mutation CommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id createdAt }
  }
}
```

`input`: `{ issueId: "<uuid>", body: "markdown..." }`. Issue UUID is
resolved from identifier with `issues(filter: { identifier: { eq: "QUI-12" } })`.

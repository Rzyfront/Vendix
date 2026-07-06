# Linear QA Queries — date-windowed (Path B)

Date-windowed GraphQL to build a sprint QA report **autonomously** from Linear. Reuses the auth,
endpoint, and constants from `linear-issues` (`references/graphql-mutations.md`) — do **not**
re-derive them here. Every result is filtered client-side to the Vendix project.

## Constants (from linear-issues)

```text
ENDPOINT   https://api.linear.app/graphql
AUTH       header  Authorization: $LINEAR_API_KEY   (raw key, NO "Bearer" prefix)
TEAM_ID    64581e80-05a2-40e8-8acb-1f091ad38168      # Quickss (key QUI)
PROJECT_ID 0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59      # Vendix
```

If `LINEAR_API_KEY` / `.linear/config.json` is missing → STOP, route to `linear-connect`.

## Window inputs

Turn the sprint window into ISO-8601 UTC bounds and confirm with the user (see `vendix-date-timezone`
for relative→absolute conversion):

```text
START = "2026-06-16T00:00:00.000Z"
END   = "2026-06-30T23:59:59.999Z"
```

Linear date fields accept `{ gte, lte }` comparators inside `filter`. Filter combinators: `and`,
`or`. Label filter: `labels: { some: { name: { eq: "..." } } }`. State bucket: `state: { type: {...} }`
where `type` ∈ `triage|backlog|unstarted|started|completed|canceled`.

---

## A. Bugs FOUND in the window (created in `[START,END]`, label bug)

`createdAt` bounds the "found" set. Adjust the label name to your bug label (see
`linear-issues/references/labels.md`).

```graphql
query BugsFound($projectId: ID!, $start: DateTimeOrDuration!, $end: DateTimeOrDuration!) {
  issues(
    first: 100
    orderBy: createdAt
    filter: {
      project: { id: { eq: $projectId } }
      labels: { some: { name: { eq: "bug" } } }
      createdAt: { gte: $start, lte: $end }
    }
  ) {
    nodes {
      identifier title url priority createdAt completedAt
      state { name type }
      assignee { name }
      labels { nodes { name } }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

Variables:

```json
{ "projectId": "0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59",
  "start": "2026-06-16T00:00:00.000Z", "end": "2026-06-30T23:59:59.999Z" }
```

> Severidad in Vendix bugs lives in the description body (see `issue-template-bug.md`), not a field.
> Map `priority` (0–4) as a proxy, OR parse the `Severidad:` line from the description if you fetch it.
> `priority`: 1=Urgent→Bloqueante, 2=High→Alta, 3=Medium→Media, 4=Low→Baja, 0=None→sin dato.

## B. Bugs RESOLVED in the window (`completedAt` in `[START,END]`)

```graphql
query BugsResolved($projectId: ID!, $start: DateTimeOrDuration!, $end: DateTimeOrDuration!) {
  issues(
    first: 100
    orderBy: updatedAt
    filter: {
      project: { id: { eq: $projectId } }
      labels: { some: { name: { eq: "bug" } } }
      completedAt: { gte: $start, lte: $end }
    }
  ) { nodes { identifier title url completedAt state { name type } } pageInfo { hasNextPage endCursor } }
}
```

## C. Tickets VALIDATED in the window

"Validated" is defined by the user (Workflow step 1). Two common encodings:

**C1 — by state** (e.g. issues that reached a QA/Done state, changed in the window):

```graphql
query Validated($projectId: ID!, $start: DateTimeOrDuration!, $end: DateTimeOrDuration!) {
  issues(
    first: 100
    orderBy: updatedAt
    filter: {
      project: { id: { eq: $projectId } }
      state: { type: { eq: "completed" } }
      updatedAt: { gte: $start, lte: $end }
    }
  ) { nodes { identifier title url updatedAt state { name } assignee { name } labels { nodes { name } } } }
}
```

**C2 — by label** (e.g. a `qa-validated` label): swap the `state` clause for
`labels: { some: { name: { eq: "qa-validated" } } }`.

> The E2E verdict (Cumple / Con defectos / No cumple / Bloqueado) is **not** a Linear field — it comes
> from the QA's `verify-ticket-prod` run (a comment, the paste-text, or the user). Ask which encoding
> the team uses and map it into `REPORT.validations[].verdict`.

---

## Fetch + shape into report.json

Send each query with the `linear-issues` curl pattern, then shape with `jq` into the `REPORT` object
the template consumes. Example for bugs-found:

```bash
Q='<BugsFound query>'
V='{"projectId":"0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59","start":"2026-06-16T00:00:00.000Z","end":"2026-06-30T23:59:59.999Z"}'
curl -sS https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d @<(jq -n --arg q "$Q" --argjson v "$V" '{query:$q, variables:$v}') \
| jq '[.data.issues.nodes[] | {
      id: .identifier, title: .title, url: .url,
      severity: ({"1":"Bloqueante","2":"Alta","3":"Media","4":"Baja","0":"sin dato"}[(.priority|tostring)]),
      module: ((.labels.nodes[].name) // "n/a"),
      state: .state.name
    }]'
```

## Rules

- **Filter to Vendix client-side** even though the query filters by `projectId` (defensive; matches
  `linear-issues`).
- **Paginate** only if `pageInfo.hasNextPage` is true and the window is large — pass `after: endCursor`.
  A sprint window rarely exceeds 100 issues; note in the report if you truncated.
- **Rate limit:** `searchIssues` is 30 req/min; the `issues` list queries are cheaper — batch the
  three (A/B/C) sequentially, don't loop.
- **Never invent** a severity, verdict, or count. Missing field → "sin dato" / `null`.
- **GraphQL errors return HTTP 200** with `"errors":[...]` — check the body, don't trust the status.
- Do **not** print the API key; if debugging auth, show only its first 4 chars.

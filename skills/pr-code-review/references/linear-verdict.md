# Review verdict → Linear label

The verdict writes a **label, never a state**. The issue stays in `Code Review` for every round trip;
release moves it (`git-workflow` RULE 10) and QA closes it (`verify-ticket-prod`). All Linear calls go
through `linear-issues`. Suggestion with confirmation, never silent.

| Outcome | GitHub | Label | State |
| --- | --- | --- | --- |
| ≥ 80 % → merged to `develop` | `gh pr merge <N>` | `Aprobado` | unchanged |
| < 80 % → sent back | `gh pr review <N> --request-changes` | `Requiere cambios` | unchanged |

## 1. Find the issue (stop at the first hit)

| Tier | Where |
| --- | --- |
| 0 | PR body `## Linear` / `QUI-XXX` / `linear.app/quickss/issue/QUI-XXX` |
| 1 | Candidates in `Code Review` (`17d15a4c-92b4-4d6e-92d7-bc7c201fb465`) |
| 2 | Candidates in `In Progress` / `Todo` / `Backlog` (devs forget to move it) |
| 3 | Ask the user. Never invent one |

Tiers 1–2 are one `linear-issues` search re-ranked locally (no state filter in `searchIssues`; 30
req/min). Recipe: `linear-issues/references/graphql-mutations.md`. Term = PR title + branch + key paths.
Show candidates with state and confirm. Drop `Done`/`Canceled`/`Duplicate`/`In Review` unless every
tier is empty.

Tier-2 hit → say it: "Encontré `QUI-418` en `In Progress`, no en `Code Review` — el ticket no se movió
al abrir el PR. ¿Lo muevo a `Code Review` junto con la label?" This correction is the only state write
allowed here, with confirmation.

## 2. Write the label

`issueUpdate.labelIds` **replaces** the set: read current labels, strip the three workflow labels, add
the verdict.

```js
const WORKFLOW_LABELS = [
  'c41a06ad-bc03-4baf-a36a-93df6230054b', // Aprobado
  '1b0a8cac-be15-4aaf-9e68-ba9f86f57574', // Requiere cambios
  'dbdfcb7c-af6f-49bb-825f-3f38f9df218e', // Devuelto (QA-owned; strip, never write)
]
const labelIds = [...current.filter(id => !WORKFLOW_LABELS.includes(id)), verdict]
```

## 3. Verify and sanity-check

- Read the issue back: a dead label UUID fails with `Entity not found: IssueLabel` while the rest
  succeeds. Not present → report failure. IDs: `linear-issues/references/labels.md`, `states.md`.
- Any tier: issue not in `Code Review` → report and offer the correction. `In Review` → do not pull
  back; ask if this is a follow-up or a wrong reference. `Done`/`Canceled`/`Duplicate` → explicit
  confirmation before touching anything.

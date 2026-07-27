# Labels — Vendix on Quickss

Verified against the Linear API on 2026-07-27. Do not auto-create new labels —
if the user wants one that does not exist, ask them to create it in Linear
first, then add its ID here and to the cache in `.linear/config.json`.

## Workflow labels (team Quickss)

These three encode the **verdict of the last review** on an issue. They are
driven by the `pr-code-review` and `verify-ticket-prod` skills — see
"Mutual exclusivity" below before writing any of them.

| Name             | Color     | ID                                     | Meaning |
| ---------------- | --------- | -------------------------------------- | ------- |
| Aprobado         | `#4cb782` | `c41a06ad-bc03-4baf-a36a-93df6230054b` | PR aprobado y mergeado a `dev` |
| Requiere cambios | `#eb5757` | `1b0a8cac-be15-4aaf-9e68-ba9f86f57574` | Code review rechazó el PR (`--request-changes`) |
| Devuelto         | `#f2994a` | `dbdfcb7c-af6f-49bb-825f-3f38f9df218e` | QA verificó en prod y NO cumple el requerimiento |

## Topic labels

| Name               | Scope     | Color     | ID                                     |
| ------------------ | --------- | --------- | -------------------------------------- |
| IA                 | team QUI  | `#f7c8c1` | `b8d3e68a-9409-4b8e-b609-2eb4372f35bf` |
| Invesigacion (sic) | team QUI  | `#f7c8c1` | `c10a0a2e-f720-46ee-a743-1607c9c3a8ca` |
| Bug                | workspace | `#EB5757` | `cc489b0b-2b1e-4d58-92de-8c261f74b67e` |
| Feature            | workspace | `#BB87FC` | `bb28dc3f-2774-44c5-ad88-5092a744c4d8` |
| Improvement        | workspace | `#4EA7FC` | `94555d1b-7006-4e51-a71e-6e7dfb98b420` |

## Mutual exclusivity (HARD RULE)

`Aprobado`, `Requiere cambios` and `Devuelto` are **mutually exclusive**. An
issue must never carry two of them at once — they are three answers to the same
question ("what did the last reviewer decide?"), and a stale one contradicts the
current truth.

Linear's `issueUpdate.labelIds` **replaces the entire label set**, it does not
append. So the correct write is: take the issue's current labels, strip all
three workflow labels, add the one you want, and send that union.

```graphql
# Read current labels first — never send a bare labelIds array.
query { issue(id: "QUI-XXX") { labels { nodes { id name } } } }
```

```js
const WORKFLOW_LABELS = [
  'c41a06ad-bc03-4baf-a36a-93df6230054b', // Aprobado
  '1b0a8cac-be15-4aaf-9e68-ba9f86f57574', // Requiere cambios
  'dbdfcb7c-af6f-49bb-825f-3f38f9df218e', // Devuelto
]
// keep every non-workflow label, then add exactly one workflow label
const labelIds = [...current.filter(id => !WORKFLOW_LABELS.includes(id)), target]
```

**Release clears them all.** When a ticket moves to `In Review` (release to
prod), strip all three and add none — see `states.md`.

## Notes

- `Invesigacion` is misspelled in Linear (missing the R). If the team fixes it,
  the ID does not change — renaming a label preserves its UUID.
- Labels that **no longer exist** and must never be reused: `prod`
  (`d6a4fc5c-…`), `dev` (`a9523fa5-…`), `Focus` (`c3173485-…`), `Revisado`
  (`de51cc7a-…`). These were cached by older versions of this skill and every
  write against them fails with `Entity not found: IssueLabel`.

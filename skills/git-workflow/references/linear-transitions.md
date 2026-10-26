# Linear transitions owned by git-workflow

All writes go through the `linear-issues` skill (never call the Linear API from here). State and label
UUIDs: `linear-issues/references/states.md` and `labels.md`. Every step is a suggestion with
confirmation: never silent, never blocking.

```
Backlog → Todo → In Progress → Code Review ──────→ In Review → Done
                     ↑          (PR open, RULE 9)   (release, RULE 10)  (QA, verify-ticket-prod)
                     └──── +Devuelto, priority High (QA fails) ────┘
```

`Code Review` = pre-merge (diff review). `In Review` = post-release (live in production, QA verifies).
Merging to `develop` does not move the issue; `pr-code-review` only adds the `Aprobado` label.

## RULE 9 — Link the PR to its Linear issue (on opening a PR to develop)

1. Ask: "¿Este cambio corresponde a un issue/ticket de Linear?" No → continue, never invent one.
2. Yes → `linear-issues` search (term from PR title / branch / key changes) or resolve the given
   `QUI-XXX`. Show candidates and confirm.
3. Add to the PR body (`gh pr edit <N> --body` or at `gh pr create`):
   ```markdown
   ## Linear
   - QUI-418 — FIX/ Error al aprobar reseña [ecommerce]
     https://linear.app/quickss/issue/QUI-418
   ```
4. Suggest moving it to `Code Review` (`17d15a4c-92b4-4d6e-92d7-bc7c201fb465`), only from `Backlog`,
   `Todo` or `In Progress`.
   - `Done` / `Canceled` / `Duplicate` → ask extra confirmation (usually a wrong reference).
   - Already `In Review` → do not pull it back; report it (likely a follow-up PR).

## RULE 10 — Release (merge develop → main) moves tickets to In Review

A release is a PR merged from `develop` into `main` (no tags, no release branch).

1. Build the list:
   ```bash
   gh pr view <N> --json commits --jq '.commits[].messageHeadline' | grep -oE 'QUI-[0-9]+' | sort -u
   gh pr view <N> --json body --jq .body | grep -oE 'QUI-[0-9]+' | sort -u
   ```
   Union with every issue in `Code Review` carrying `Aprobado`. Let the user confirm or trim.
2. For each confirmed ticket: state → `In Review` (`d123e233-1f17-422e-b7c0-06f463e798df`); labels →
   current minus all three workflow labels (`Aprobado`, `Requiere cambios`, `Devuelto`). `labelIds`
   replaces the whole set: read current labels first.
3. Guards: ticket tagged `Requiere cambios` → flag and ask, do not move. Already `In Review` / `Done` /
   `Canceled` / `Duplicate` → skip and report.
4. Report what moved and what was skipped, with reasons. Never apply partially in silence.

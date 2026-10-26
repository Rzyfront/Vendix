# Deduplication check (before every create)

Runs after the title + purpose are assembled, before `issueCreate`. Skip only if the user says
"créalo igual" — and note that the check was skipped.

## Search

1. `term` = title without `FIX/`/`FEAT/`/`DEV/`/`CHORE/` + module tag + key nouns of the story.
   Never the full body.
2. `searchIssues(term, teamId)` (`graphql-mutations.md`): full-text + vector, 30 req/min, no state
   argument — one call, re-rank client-side.
3. Filter to `project.id == 0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59`; keep ~5 top candidates.

## Judge (semantic, ~70 % shared purpose)

- Duplicate: same module AND same feature/broken behavior; same problem worded differently; same
  error/symptom/endpoint.
- Related (mention, not duplicate): same module, different concern; same feature, different sub-task.
- Open match → true duplicate. `completed`/`canceled` match → possible regression.

## Present and wait

```
Encontré issue(s) que podrían ser el mismo o estar muy relacionados:
1. QUI-418 — FIX/ Error al aprobar reseña [ecommerce] — In Progress
   https://linear.app/quickss/issue/QUI-418
   Por qué: mismo módulo y mismo flujo de aprobación.
```

| Option | Action |
| --- | --- |
| 1. Actualizar el existente | `issueUpdate`: merge description, union labels, raise priority if higher |
| 2. Comentar en el existente | `commentCreate` with the new story / repro |
| 3. Crear uno nuevo igual | `issueCreate` (reference the old one if regression) |
| 4. Cancelar | nothing |

Never auto-pick. If search fails / is rate-limited / returns nothing: say "no se pudo verificar
duplicados" (or "no encontré duplicados") and continue to the create confirmation.

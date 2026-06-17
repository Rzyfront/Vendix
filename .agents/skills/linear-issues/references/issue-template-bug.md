# Bug Issue Template (FIX/)

Use this template for any issue that reports a defect, broken behavior, or
unexpected result. The agent MUST collect every field marked **required**
before calling the Linear API.

## Title format

```
FIX/ <sentence-case description> [<module>]
```

**Rules:**

- Prefix is **always** `FIX/` (uppercase, slash, single space)
- After the prefix, the description starts with a capital letter
- No trailing period
- Maximum ~60 characters total (Linear truncates aggressively on small screens)
- The `[<module>]` tag is optional but recommended; use one of:
  `admin`, `ecommerce`, `mobile`, `core`, `api`, `infra`
- Bad: `fix/bug en checkout`, `FIX/Bug en checkout.`, `FIX/ Bug`
- Good: `FIX/ Error al finalizar compra en ecommerce [ecommerce]`

**If the user's title does not match this format, the agent MUST:**

1. Suggest a corrected title following the rules above
2. Wait for the user to confirm or override before creating the issue

## Required fields (collected by the agent)

The agent MUST ask for every field marked required. If the user cannot
provide one, mark the issue with `priority: 0` (no priority) and skip
validation, but still create the issue — never block creation on missing
optional info.

| Field | Required | Source | Notes |
|---|---|---|---|
| **Title** | yes | user input | must follow the `FIX/` format above |
| **Description** (markdown body) | yes | assembled from the template below | never send an empty description for a bug |
| **Priority** | yes | user input or inferred | 1=urgent, 2=high, 3=medium, 4=low, 0=none |
| **App / module tag** | yes | derived from title or asked | drives the `[<module>]` suffix |
| **Entorno** | yes | asked | app (admin/ecommerce/mobile), store name or NIT, date |
| **Pasos para reproducir** | yes | asked | numbered list, minimum 2 steps |
| **Comportamiento actual** | yes | asked | what happens now |
| **Comportamiento esperado** | yes | asked | what should happen |
| **Capturas / logs** | no | asked | URLs, pasted text, or "n/a" |
| **Severidad (Bloqueante/Alta/Media/Baja)** | yes | asked | drives the priority if user does not provide one |
| **Assignee** | no | user input | "me" or an email; default = unassigned |
| **Labels** | no | user input | must be one of the six existing labels |

## Priority inference from severity

If the user did not provide a priority, infer it from **Severidad**:

| Severidad | Priority (numeric) |
|---|---|
| Bloqueante | 1 (urgent) |
| Alta | 2 (high) |
| Media | 3 (medium) |
| Baja | 4 (low) |

The agent MUST confirm the inferred priority with the user before creating.

## Description template (markdown body)

This is the exact markdown the agent assembles and sends in the
`description` field of `issueCreate`. The agent fills in user answers
where there are placeholders.

````markdown
## Entorno
- **App:** <admin | ecommerce | mobile>
- **Store:** <nombre o NIT>
- **Fecha:** YYYY-MM-DD

## Pasos para reproducir
1. <step>
2. <step>
3. <step>

## Comportamiento actual
<what happens now — be specific, include error messages verbatim>

## Comportamiento esperado
<what should happen>

## Capturas / logs
<URLs, pasted output, or "n/a">

## Severidad
- [ ] Bloqueante (no se puede operar)
- [ ] Alta (workaround incómodo)
- [ ] Media (workaround existe)
- [ ] Baja (cosmético)
````

**Section rules:**

- All six section headers (`##`) are mandatory, in this order
- The "Severidad" checkboxes must keep exactly one ticked — the agent
  reflects the user's choice
- "Capturas / logs" is required as a section header even if empty —
  the agent writes `n/a` inside
- Bullets in "Entorno" must use `- **` for the label
- Numbered lists in "Pasos" use `1. ` (no nested lists)

## Example — fully filled

**Title:** `FIX/ Error al aprobar reseña desde ecommerce [ecommerce]`

**Description:**

```markdown
## Entorno
- **App:** ecommerce
- **Store:** Vendix Demo Store (NIT 900123456)
- **Fecha:** 2026-06-08

## Pasos para reproducir
1. Ingresar al panel admin como moderador
2. Ir a la sección Reseñas pendientes
3. Hacer clic en "Aprobar" sobre una reseña
4. Observar la respuesta del servidor

## Comportamiento actual
El endpoint devuelve 500 Internal Server Error. En consola del navegador:
```
TypeError: Cannot read properties of undefined (reading 'id')
    at ReviewController.approve (review.controller.ts:127)
```

## Comportamiento esperado
La reseña se marca como aprobada, desaparece de pendientes y aparece en
la lista de aprobadas con un toast de confirmación.

## Capturas / logs
https://drive.example.com/screenshots/2026-06-08-review-500.png
Sentry: VENDIX-REVIEW-7421

## Severidad
- [x] Alta (workaround incómodo)
- [ ] Bloqueante (no se puede operar)
- [ ] Media (workaround existe)
- [ ] Baja (cosmético)
```

**Linear payload variables (for reference, see `graphql-mutations.md`):**

```json
{
  "input": {
    "teamId": "64581e80-05a2-40e8-8acb-1f091ad38168",
    "projectId": "0b7c9c45-7fc1-4915-ac77-8e1cb56d7c59",
    "title": "FIX/ Error al aprobar reseña desde ecommerce [ecommerce]",
    "description": "<the markdown body above>",
    "priority": 2,
    "labelIds": ["..."]
  }
}
```

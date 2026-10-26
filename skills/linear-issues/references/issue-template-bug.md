# Issue templates (FIX/ and FEAT/ · DEV/ · CHORE/)

Every issue starts with the **user story**, the **steps a person follows on screen**, and
**observable acceptance criteria**. Technical detail goes underneath as notes.

## Bug title

```
FIX/ <sentence-case description> [<module>]
```

- Prefix `FIX/` uppercase + single space; no trailing period; ~60 chars max.
- `[<module>]` optional but recommended: `admin`, `ecommerce`, `mobile`, `core`, `api`, `infra`.
- Bad: `fix/bug en checkout`, `FIX/Bug en checkout.`, `FIX/ Bug`. Good: `FIX/ Error al finalizar compra [ecommerce]`.
- If the user's title does not match: propose a correction and wait for confirmation.

## Bug fields

| Field | Required | Notes |
|---|---|---|
| Historia de usuario | yes | "Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>" (the role/flow that breaks) |
| Entorno | yes | app (admin/ecommerce/mobile), store name or NIT, date (default today) |
| Pasos para reproducir | yes | numbered, what the person does on screen, min 2 |
| Comportamiento actual | yes | what the person sees now; error text verbatim |
| Comportamiento esperado / criterios de aceptación | yes | observable checklist of what the person should see |
| Severidad | yes | Bloqueante (no se puede operar) · Alta (workaround incómodo) · Media (workaround existe) · Baja (cosmético) |
| Capturas / logs | no | URLs, pasted text or `n/a` |
| Notas técnicas | no | endpoint, status, stack trace, suspected file |
| Priority | yes | user value, else inferred from Severidad and confirmed |
| Assignee | no | "me", email, or unassigned (default) |
| Labels | no | one of the existing labels (`labels.md`) |

Missing required field the user cannot give: write `n/a`, create with `priority: 0`, tell the user.
Never invent stores, NITs, errors or steps.

### Priority from Severidad

| Severidad | Priority |
|---|---|
| Bloqueante | 1 (urgent) |
| Alta | 2 (high) |
| Media | 3 (medium) |
| Baja | 4 (low) |

## Bug description body (exact section order)

````markdown
## Historia de usuario
Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>.

## Entorno
- **App:** <admin | ecommerce | mobile>
- **Store:** <nombre o NIT>
- **Fecha:** YYYY-MM-DD

## Pasos para reproducir
1. <lo que hace la persona en pantalla>
2. <...>

## Comportamiento actual
<lo que ve la persona; mensajes de error textuales>

## Criterios de aceptación
- [ ] <lo que la persona debe ver cuando esté corregido>
- [ ] <...>

## Capturas / logs
<URLs, texto pegado o "n/a">

## Severidad
- [ ] Bloqueante (no se puede operar)
- [ ] Alta (workaround incómodo)
- [ ] Media (workaround existe)
- [ ] Baja (cosmético)

## Notas técnicas
<endpoint, status, traza, archivo sospechoso o "n/a">
````

Rules: all `##` headers mandatory and in this order; exactly one Severidad box ticked; `n/a` inside
empty sections; `Entorno` bullets use `- **`; steps use `1. ` without nesting.

## Feature / task body (FEAT/ · DEV/ · CHORE/)

Title: sentence-case imperative with prefix (`FEAT/` user-facing, `DEV/` internal/refactor/infra,
`CHORE/` deps/config/cleanup). `DEV/` and `CHORE/` may skip the story if there is no user-facing
change; say so in one line.

````markdown
## Historia de usuario
Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>.

## Cómo se prueba en pantalla
1. <paso que sigue la persona>
2. <...>

## Criterios de aceptación
- [ ] <lo que la persona ve>

## Notas técnicas
<alcance, endpoints, módulos, dependencias>
````

## Example (bug, filled)

Title: `FIX/ Error al aprobar reseña desde ecommerce [ecommerce]`

```markdown
## Historia de usuario
Como moderador en el panel admin de Vendix Demo Store, quiero aprobar reseñas pendientes para publicarlas en la tienda.

## Entorno
- **App:** ecommerce
- **Store:** Vendix Demo Store (NIT 900123456)
- **Fecha:** 2026-06-08

## Pasos para reproducir
1. Ingresar al panel admin como moderador
2. Ir a Reseñas pendientes
3. Hacer clic en "Aprobar" sobre una reseña

## Comportamiento actual
Aparece "Error interno del servidor" y la reseña sigue en pendientes.

## Criterios de aceptación
- [ ] La reseña desaparece de pendientes y aparece en aprobadas
- [ ] Se muestra un toast de confirmación

## Capturas / logs
Sentry: VENDIX-REVIEW-7421

## Severidad
- [ ] Bloqueante (no se puede operar)
- [x] Alta (workaround incómodo)
- [ ] Media (workaround existe)
- [ ] Baja (cosmético)

## Notas técnicas
`POST /api/store/reviews/:id/approve` → 500 `TypeError: Cannot read properties of undefined (reading 'id')`.
```

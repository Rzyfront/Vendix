# States — Vendix on Quickss

These eight states are the **complete** set. Verified against the Linear API on
2026-07-27. Workflow order is by `type` group first, then by `position` within
the group.

| Position | Name        | Type        | ID                                       |
| -------- | ----------- | ----------- | ---------------------------------------- |
| 0        | Backlog     | `backlog`   | `4b74cd22-2daa-4220-bccc-002a6b4121de`   |
| 1        | Todo        | `unstarted` | `1c3e8e81-3fa4-46fa-9674-0d46e6bb003f`   |
| 2        | In Progress | `started`   | `e24cd9a7-66db-4e49-93cb-d3f1c99df2f7`   |
| 502      | Code Review | `started`   | `17d15a4c-92b4-4d6e-92d7-bc7c201fb465`   |
| 1002     | In Review   | `started`   | `d123e233-1f17-422e-b7c0-06f463e798df`   |
| 3        | Done        | `completed` | `30f4c5c5-e1de-43a7-b00e-b737fc6e73a4`   |
| 4        | Canceled    | `canceled`  | `6081e147-8c02-4531-9437-e9d6115559fd`   |
| 5        | Duplicate   | `duplicate` | `226e301e-6078-4ebd-81b2-d0177d2683ac`   |

## The Vendix pipeline

```
Backlog → Todo → In Progress → Code Review → In Review → Done
                     ↑              │             │        ↑
                     │              │             │        │ QA OK
                     └──────────────┴─────────────┴────────┘
                       Devuelto (QA falla) → Todo, prioridad Alta
```

| # | Trigger                          | Actor   | Estado destino          | Labels                       |
| - | -------------------------------- | ------- | ----------------------- | ---------------------------- |
| 1 | Ticket creado                    | —       | `Backlog`               | —                            |
| 2 | Priorizado para trabajarse       | —       | `Todo`                  | —                            |
| 3 | Dev arranca                      | dev     | `In Progress`           | —                            |
| 4 | Abre PR contra `develop`         | dev     | `Code Review`           | —                            |
| 5 | PR aprobado + merge a `develop`  | revisor | `Code Review` (sin cambio) | `+Aprobado`               |
| 6 | PR rechazado (`--request-changes`) | revisor | `Code Review` (sin cambio) | `+Requiere cambios`     |
| 7 | Release: merge del PR `develop`→`main` | revisor | `In Review`           | **limpiar las tres**         |
| 8 | QA verifica en prod y pasa       | QA      | `Done`                  | —                            |
| 9 | QA verifica en prod y falla      | QA      | `Todo`                  | `+Devuelto` · prioridad Alta |

**Pasos 5 y 6 son un bucle.** El estado `Code Review` aguanta todas las
iteraciones de ida y vuelta del PR; la label marca el veredicto vigente. Solo el
release (paso 7) saca al ticket de ahí.

## Las dos compuertas no son la misma

Nunca confundir `Code Review` con `In Review`:

- **`Code Review`** — PRE-merge. Revisión técnica del diff por un humano. El
  código todavía no está en `dev`.
- **`In Review`** — POST-release. El cambio ya está en **producción** y QA lo
  está verificando contra el requerimiento del ticket
  (skill `verify-ticket-prod`).

Un ticket en `In Review` **no lleva labels de workflow** — el veredicto del code
review ya cumplió su función y arrastrarlo a la fase de QA induce a error.

## Defaults

- Los issues nuevos caen en `Todo` (`1c3e8e81-3fa4-46fa-9674-0d46e6bb003f`)
  salvo que el usuario indique otra cosa.
- "Open" / "active" = todo excepto `Done`, `Canceled`, `Duplicate`
  (filtrar por `state.type neq "completed"` y excluir los tipos canceled y
  duplicate en código si hace falta).

## Nota sobre `position`

`position` **no es un orden global**: Linear agrupa primero por `type`
(`backlog` → `unstarted` → `started` → `completed` → `canceled`) y recién ahí
ordena por `position` dentro del grupo. Por eso `Done` (pos 3) va después de
`In Review` (pos 1002) pese al número menor, y por eso `Code Review` usa 502
para intercalarse entre `In Progress` (2) e `In Review` (1002).

Al crear un estado nuevo, Linear le asigna una posición alta y no contigua
(~1000+); no renumera las existentes. Elegí un valor intermedio a mano.

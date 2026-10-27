# Parity Report format

Write to the scratchpad or a user-named path, never inside a skill folder.

```markdown
# Parity Audit — <web target> (<app_type / persona>)

## Scope
- Web target: `apps/frontend/src/app/private/modules/<...>`
- Surface / app_type: <STORE_ADMIN | ORG_ADMIN | SUPER_ADMIN | STORE_ECOMMERCE>
- Mobile counterpart: `apps/mobile/app/(<group>)/<...>` + `apps/mobile/src/features/<...>`
- Shared backend domain(s): `apps/backend/src/domains/<...>`

## Web Functional Inventory   <!-- one subsection per taxonomy dimension -->
## Mobile Current State        <!-- same granularity -->

## Strategic Gap Map
| Capability | Web | Mobile | Status | Priority | Endpoint / gate | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| <capability> | ✅ | ❌ | Absent | P0 | `GET /store/orders` · perm `orders.read` | ... |
| <capability> | ✅ | ⚠️ | Partial | P1 | ... | mobile lacks the edit action |
| <capability> | ✅ | ✅ | Present | — | ... | parity reached |
| <capability> | ✅ | — | N/A-mobile | — | — | web-only bulk export; justification |

## Coverage Summary
Present N/total · Partial N · Absent N · N/A N → <parity %> (over the full taxonomy inventory)

## User stories for the gaps (input to odd/tasks/<feature>.md)
### HU-1 — <capability>
- Historia: Como <rol> en la app móvil <surface>, quiero <funcionalidad> para <resultado>.
- Pasos en pantalla (como en web): 1. … 2. …
- Criterios de aceptación observables: - [ ] <lo que la persona ve en el móvil>
- Notas técnicas: endpoint, DTO, permiso, prioridad, dependencia.

## Recommended Sequencing
1. <Absent P0> — why first
2. <Partial P1> — depends on #1
```

Status: `Present` = same behavior · `Partial` = missing an action, state, validation or endpoint, or
calls the endpoint differently (contract drift) · `Absent` · `N/A-mobile` = intentionally web-only,
justified. Priority P0–P2 = business value + dependency order, not effort.
Mobile capabilities that web lacks: note as inverse gap in `Notes`.

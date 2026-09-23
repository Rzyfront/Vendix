---
id: B.4
title: "Mesero visible en la mesa"
phase: B
status: in-progress
owner: Turing
updated: 2026-09-20
contracts: [FB-21, FB-44, FB-45, DB-16, DB-45]
adrs: [ADR-04]
skills: [vendix-backend, vendix-prisma-scopes, vendix-restaurant-ops, vendix-frontend, vendix-zoneless-signals, vendix-panel-ui, how-to-test]
---
# B.4 — Mesero visible en la mesa

- **Skills:** `vendix-backend` y `vendix-prisma-scopes` (el `include` de la relación del usuario que abrió, dentro del alcance de tienda y sin engordar el `select`) · `vendix-restaurant-ops` (qué es el mesero de una mesa) · `vendix-frontend` y `vendix-zoneless-signals` (la interfaz de sesión y el tile del mapa se pintan desde signals) · `vendix-panel-ui` (el nombre del mesero es dato de negocio, no un permiso: no cambia visibilidad de módulo) · `how-to-test`.
- **Resources:** ADR-04 (decisión, alternativa descartada y el activo a replicar) · precedente ya escrito y en uso: `apps/backend/src/domains/store/orders/orders.service.ts:1061-1085` (`include` de `table_sessions` con `opener: { select: { id, first_name, last_name } }`, `orderBy:{id:'desc'}, take:1`) pintado por `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.html:520-525` · `apps/backend/src/domains/store/tables/table-sessions.service.ts:1926-1999` (`findOne` proyecta `table.waiter` **desde el pivote `table_waiters`**, no desde quien abrió) y `:173-179` (`CreatedOpenSession`, que ya devuelve `opened_by`) · `apps/backend/src/domains/store/tables/tables.service.ts:23-58` y `:766-778` (`FloorMapTable.active_session.opened_by`, número crudo que ninguna vista resuelve) · `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/interfaces/table.interface.ts:105-129` (`TableSession` sin mesero) · `apps/backend/prisma/schema.prisma` modelo `table_sessions` (`opened_by Int?`, relación `opener`) · registry filas FB-21, FB-44, FB-45, DB-16, DB-45 · ficha de origen `F-028` en `docs/critical-plans/CP-pos-order-flows-audit/findings/`.
- **Business decision:** El mesero de una mesa **es quien abrió la sesión**. Lo fija ADR-04 con decisión del dueño del 2026-09-20 citada textualmente: *"Quien abrió la sesión"*. Se descartó un responsable mutable con traspaso de turno: modela el relevo, cuesta una migración y un flujo que nadie pidió. Límite aceptado explícitamente: si el mesero cambia de turno, la mesa sigue mostrando a quien la abrió.
- **Why:** El dueño pidió ver qué mesero tiene cada mesa y el dato ya está escrito: `opened_by` se graba en toda sesión nueva. Lo que falta es resolverlo a nombre y declararlo. Hay además una trampa concreta: ya existe un objeto `waiter` en la respuesta de sesión, pero se alimenta del pivote `table_waiters` —la asignación estática de meseros a mesas—, no de quien realmente abrió la cuenta. Dejarlo así significa que la pantalla muestra un mesero plausible y equivocado. El mapa de salón expone `opened_by` como número crudo que ninguna vista traduce, y la interfaz del frontend no declara el campo, así que ninguna vista podría pintarlo aunque llegara.
- **Output:** El `include` de la relación del usuario que abrió, replicado del precedente de orden, en la respuesta de sesión de mesa y en la sesión activa del mapa de salón; el objeto `waiter` cambia de fuente del pivote a quien abrió, conservando la forma del contrato; `paid_at` añadido al mismo constructor de fila del mapa si B.3 no lo dejó; el campo declarado en la interfaz de sesión del frontend; el nombre del mesero pintado en la página de mesa y en el tile del mapa de salón; comentario en el pivote advirtiendo que ya no alimenta esta proyección.
- **Contracts touched:** FB-21 (precedente que se replica, sin cambio), FB-44 (la respuesta de sesión cambia la fuente de `waiter`), FB-45 (`active_session` resuelve el mesero a nombre en vez de exponer un id crudo), DB-16 (se apoya en que toda sesión nueva lleva quien la abrió), DB-45 (el pivote `table_waiters` queda leído pero deja de ser la fuente del mesero mostrado).
- **Data impact:** none — solo lectura. El dato ya está escrito en producción para toda sesión existente, así que **no hay backfill**, no hay migración y no hay sesiones sin mesero. Sin DDL: `opened_by` y su relación ya están en el esquema. Si la verificación encontrara sesiones con quien abrió en nulo, el paso **no** inventa una columna ni un relleno: lo registra como hallazgo y la vista muestra el vacío.
- **Blast radius:** El riesgo silencioso es el cambio de fuente: cualquier consumidor que hoy lea `waiter` esperando la asignación del pivote pasa a recibir a quien abrió, sin que cambie la forma y por tanto sin que nada falle al compilar. Hay que barrer los consumidores antes de cortar. Riesgo de rendimiento bajo pero real: un `include` mal acotado en el mapa de salón multiplica consultas por mesa. Lo nota el mesero, que ve un nombre distinto al que esperaba, y el encargado en el listado.
- **Rollback:** Trivial —así lo declara ADR-04 §Reversibility—: revertir el commit devuelve el pivote como fuente y quita el campo de la interfaz. Nada escrito que deshacer. Si más adelante el negocio pide un responsable mutable, la vuelta es aditiva: quien abrió se conserva como historia y el campo nuevo se superpone en la proyección.
- **Verification:**
  - `curl -sk -H "Authorization: Bearer $TOKEN" "https://api.vendix.com/api/store/table-sessions/$SESSION_ID" | tee ../evidence/B.4-sesion.json | jq '.data.table.waiter'`
  - `curl -sk -H "Authorization: Bearer $TOKEN" "https://api.vendix.com/api/store/tables/floor-map" | tee ../evidence/B.4-floormap.json | jq '.data[].active_session'`
  - `psql "$DATABASE_URL" -c "SELECT count(*) FROM table_sessions WHERE closed_at IS NULL AND opened_by IS NULL;"` (espera 0; si no, se registra como hallazgo)
  - `psql "$DATABASE_URL" -c "SELECT s.id, s.opened_by, u.first_name, u.last_name FROM table_sessions s LEFT JOIN users u ON u.id = s.opened_by WHERE s.closed_at IS NULL LIMIT 20;"` (contrastar con el JSON anterior)
  - `grep -rn "table_waiters" apps/backend/src apps/frontend/src | tee ../evidence/B.4-pivote-consumidores.txt` (barrido de consumidores antes de cortar)
  - `grep -n "waiter" apps/frontend/src/app/private/modules/store/restaurant-ops/tables/interfaces/table.interface.ts`
  - `npm --prefix apps/backend run test:path -- src/domains/store/tables/table-sessions.service.spec.ts`
  - Playwright MCP — abrir el mapa de salón y la página de una mesa abierta por un usuario conocido y confirmar que el nombre mostrado es el de quien la abrió; guardar en `evidence/B.4-e2e-mesero.md`
- **Acceptance checklist:**
  - [ ] El mesero mostrado se resuelve desde quien abrió la sesión, nunca desde el pivote de asignación
  - [ ] El `include` replica el precedente ya en uso en el detalle de orden, con el mismo `select` acotado
  - [ ] El objeto de mesero conserva su forma actual: cambia la fuente, no el contrato
  - [ ] Los consumidores del pivote quedan barridos y listados antes de cortar la fuente
  - [ ] El mapa de salón deja de exponer un identificador crudo sin resolver
  - [ ] La interfaz de sesión del frontend declara el campo del mesero
  - [ ] La página de mesa muestra el nombre del mesero
  - [ ] El tile del mapa de salón muestra el nombre del mesero
  - [ ] Una sesión sin quien la abrió se pinta vacía y no rompe la vista
  - [ ] No se añade columna, migración ni relleno de datos
  - [ ] El mapa de salón no aumenta su número de consultas por mesa
  - [ ] Queda anotado en el pivote que ya no alimenta esta proyección
  - [ ] Las filas FB-21, FB-44, FB-45, DB-16 y DB-45 quedan marcadas con su evidencia enlazada
- **Status:** in-progress — opener en página/tile (70b74852c) y tiquetes (8c74f9683); falta Jest de impresión/E2E.

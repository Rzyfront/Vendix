---
id: G.2
title: "Endpoint y UI de reasignación de mesa"
phase: G
status: in-progress
owner: none
updated: 2026-09-23
contracts: [FB-49, FB-48, FB-50, FB-21, DB-19, DB-20, DB-22, DB-11, DB-16, ERR-28, ERR-29, ERR-30, ERR-31, ERR-32, ERR-42]
adrs: [ADR-07, ADR-04]
skills: [vendix-backend, vendix-restaurant-ops, vendix-prisma-scopes, vendix-error-handling, vendix-frontend-modal, vendix-zoneless-signals, how-to-test]
---
# G.2 — Endpoint y UI de reasignación de mesa

- **Skills:** `vendix-backend` (controlador + servicio + DTO) · `vendix-restaurant-ops` (mesa, sesión, ticket de cocina) · `vendix-prisma-scopes` (todo `table_sessions` y `kitchen_tickets` bajo scope de tienda) · `vendix-error-handling` (P2002 mapeado, nunca 500 crudo) · `vendix-frontend-modal` (se cuelga del modal de traslado existente) · `vendix-zoneless-signals` (señales y `input()`/`output()` del modal, cero `NgZone`) · `how-to-test` (curl para el contrato, Playwright MCP para el recorrido).
- **Resources:** `apps/backend/src/domains/store/tables/table-sessions.service.ts:1229-1400` (`transferSession`: re-lectura TOCTOU dentro de la tx, guard de carrera sobre la mesa destino, re-estampado de `kitchen_tickets.table_id` en `:1317-1321`, evento `session_moved`) · `:363-450` (`createOpenSessionInTx`, que HOY siempre crea una orden nueva y captura el P2002 del índice parcial) · `apps/backend/src/domains/store/tables/table-sessions.controller.ts:134-150` (precedente de ruta `transfer` con `store:table_sessions:update`) · `apps/backend/src/domains/store/tables/dto/table-session.dto.ts` (el DTO de apertura no admite `order_id`) · `apps/backend/src/domains/store/orders/order-flow/order-lifecycle-lock.util.ts` (`lockOrderLifecycle`) · `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/transfer-table-modal/transfer-table-modal.component.ts:53-63` · `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/tables.service.ts:359-380` · ADR-07 · ficha de origen `F-029`.
- **Business decision:** reasignar **abre una sesión nueva** sobre la mesa destino, enlazada a la misma orden, y **conserva la sesión cerrada intacta** como historia. No se muta `closed_at`, no se crea orden y no se re-dispara cocina. La elegibilidad la decide el util de G.1 y se evalúa ANTES de escribir. El selector de mesa destino excluye las ocupadas y marca las reservadas, para que el rechazo sea la excepción y no el camino normal.
- **Why:** hoy no existe forma de devolverle la mesa a una orden cerrada por error: `transferSession` exige la sesión ORIGEN abierta (`:1250-1253`) y `openSession` siempre crea una orden nueva. Mecánicamente sí es viable porque `table_sessions.order_id` no es único; lo que faltaba era una puerta que respetara las cinco invariantes (índice único parcial, re-estampado de cocina, `inventory_consumed_at_fire` sin re-disparo, orden no cobrada ni facturada, y editabilidad posterior).
- **Output:** `POST /store/table-sessions/reassign` con DTO `{ order_id, target_table_id }` y `forbidNonWhitelisted`; método `reassignSessionToTable` en `TableSessionsService` que toma `lockOrderLifecycle` y corre en una sola transacción; cliente HTTP y acción en el modal de traslado; entrada nueva en el mapa código→mensaje del frontend para los rechazos. **Dependencia declarada:** `order-lifecycle-lock.util.ts` figura como `??` en `git status` (trabajo en vuelo de otra sesión sobre el mismo árbol). Si ese archivo se pierde, este paso se queda sin lock y no arranca: se bloquea, no se improvisa un mecanismo de serialización nuevo.
- **Contracts touched:** FB-49, FB-48, FB-50, FB-21, DB-19, DB-20, DB-22, DB-11, DB-16, ERR-28, ERR-29, ERR-30, ERR-31, ERR-32, ERR-42
- **Data impact:** escribe, dentro de una sola transacción: 1 fila nueva en `table_sessions` (`order_id` de la orden existente, `table_id` destino, `opened_by` = usuario que reasigna, coherente con ADR-04), `tables.status = 'occupied'` en la mesa destino, y `kitchen_tickets.table_id` re-estampado con `updateMany` filtrado por `order_id` + `store_id`. NO escribe `orders`, NO toca la sesión cerrada, NO toca `order_items.inventory_consumed_at_fire`. Sin migración: el índice parcial y la no-unicidad de `order_id` ya existen.
- **Blast radius:** mesas, plano de mesas y tablero de cocina de la tienda. Si la transacción escribe a medias, un ticket queda apuntando a la mesa vieja y la comanda sale al lugar equivocado: lo nota la cocina. Si el guard de carrera falla, el índice único parcial rechaza con P2002 y —sin el catch— saldría 500: lo nota el mesero. Si el lock no se toma, un cobro concurrente puede liquidar la orden a mitad de la reasignación.
- **Rollback:** revertir el commit del endpoint y de la UI. Las sesiones ya creadas siguen siendo filas válidas y el índice parcial impide el peor caso por construcción; lo que se pierde es la pantalla que sabe explicarlas (ADR-07 lo declara `costly` por eso). La sesión original nunca se mutó, así que el dato es recuperable.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/tables/table-sessions.service.spec.ts` con casos: mesa destino libre, mesa destino ocupada, mesa `reserved`, orden cobrada, orden sin sesión previa
  - `curl -s -o evidence/G2-reassign-ok.json -w '%{http_code}' -X POST "$API/store/table-sessions/reassign" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"order_id":'"$ORDER_ID"',"target_table_id":'"$TABLE_ID"'}'` → 201
  - `curl … -d '{"order_id":N,"target_table_id":M,"campo_no_declarado":1}' -o evidence/G2-reassign-422.json` → 422 `SYS_VALIDATION_001`
  - `curl … ` contra mesa ocupada, mesa `reserved`, orden `cancelled` y orden sin mesa → 409/409/409/404, cada respuesta a `evidence/G2-reassign-<caso>.json`
  - SQL de solo lectura tras el caso feliz: `SELECT count(*) FROM table_sessions WHERE order_id = :o AND closed_at IS NULL;` = 1 y `SELECT count(*) FROM table_sessions WHERE order_id = :o;` = 2 → `evidence/G2-invariantes.txt`
  - SQL de solo lectura: `SELECT k.id, k.table_id FROM kitchen_tickets k WHERE k.order_id = :o;` todos en la mesa destino
  - Playwright MCP contra `vendix.com`: abrir mesa → pedir → disparar cocina → cerrar por error → reasignar desde el modal → agregar un plato (debe aceptar) → captura a `evidence/G2-recorrido.png`
- **Acceptance checklist:**
  - [ ] Reasignar deja exactamente una sesión abierta para la orden y conserva la cerrada con su `closed_at` original
  - [ ] La orden no cambia de `id` ni de `order_number`: no se crea ninguna orden nueva
  - [ ] Los `kitchen_tickets` de la orden quedan re-estampados a la mesa destino en la misma transacción
  - [ ] `order_items.inventory_consumed_at_fire` no cambia de valor ni vuelve a disparar consumo
  - [ ] Mesa destino ocupada devuelve 409 tipado y cero filas nuevas; el P2002 del índice parcial nunca sale como 500
  - [ ] Mesa destino `reserved` devuelve 409 `TABLE_INVALID_STATUS` y el selector la muestra marcada
  - [ ] Orden cobrada, con split activo o facturada devuelve 409 con `details.reason`; orden sin mesa devuelve 404
  - [ ] Tras reasignar, `add-items` sobre la sesión nueva devuelve 200 (el guard de G.1 ya está en su sitio)
  - [ ] El endpoint toma `lockOrderLifecycle`; si el util no está en el árbol, el paso queda bloqueado y se dice en el log
  - [ ] El modal de traslado ofrece la acción solo cuando la orden es elegible, y el mapa de mensajes cubre los cinco rechazos
  - [ ] Todo test de rechazo fija el `errorCode` y el conteo de filas antes/después
- **Status:** in-progress — endpoint atómico y QA real `evidence/G2-reassign-backend-20260923.md`, `G2-reassign-runtime-20260923.md`: HTTP201 misma orden + nueva sesión, add-items 201, 409/400 tipados, 2 sesiones históricas, QA cerrada/mesas disponibles. Falta KDS con ticket y UI modal.

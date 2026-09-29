---
id: G.1
title: "Reformular el guard de edición y definir la elegibilidad"
phase: G
status: done
owner: fox
updated: 2026-09-24
contracts: [FB-18, FB-50, DB-19, DB-20, ERR-06, ERR-29, ERR-30, ERR-31]
adrs: [ADR-07]
skills: [vendix-backend, vendix-restaurant-ops, vendix-prisma-scopes, vendix-error-handling, how-to-test]
---
# G.1 — Reformular el guard de edición y definir la elegibilidad

- **Skills:** `vendix-backend` (servicio de dominio, excepción tipada) · `vendix-restaurant-ops` (invariantes de mesa y sesión) · `vendix-prisma-scopes` (lectura de `table_sessions` bajo el scope de tienda, sin `findUnique` sobre clave compuesta) · `vendix-error-handling` (alta en `error-codes.ts` y `VendixHttpException`) · `how-to-test` (carriles feliz / triste / fuerza bruta). La elegibilidad se escribe como util puro con spec propio, copiando la forma de `order-cancellation-policy.util.ts`: ninguna regla nueva queda enterrada dentro del servicio.
- **Resources:** `apps/backend/src/domains/store/orders/orders.service.ts:1812-1832` (el guard `ORD_EDIT_NOT_ALLOWED_001` y su comentario de origen CP-POLLO-ARABE-727) · `apps/backend/src/domains/store/orders/shared/financial-split-policy.ts` (`assertNoActiveFinancialSplit`, ya invocado en `orders.service.ts:1801`) · `apps/backend/src/domains/store/tables/table-sessions.service.ts:1250-1260` (la elegibilidad que `transferSession` ya sabe expresar) · `apps/backend/src/common/errors/error-codes.ts` (catálogo único) · ADR-07 · ficha de origen `F-029` en `docs/critical-plans/CP-pos-order-flows-audit/findings/`.
- **Business decision:** una orden con historial de mesa es editable **si y solo si tiene una sesión abierta**. El guard deja de preguntar «¿existe alguna sesión cerrada?» y pasa a preguntar «¿existe alguna sesión abierta?»: sin ninguna abierta bloquea exactamente como hoy; con una abierta —el estado que produce ADR-07— permite editar. Y la elegibilidad para devolverle mesa a una orden se fija aquí, antes de que exista el endpoint: orden ni `cancelled` ni `refunded`, sin pago `succeeded`/`captured`, sin split financiero activo y sin factura emitida.
- **Why:** hoy el guard hace `findFirst({ order_id, closed_at: { not: null } })` y lanza por la EXISTENCIA de una sesión cerrada. ADR-07 conserva esa fila a propósito, como historia inmutable del cierre erróneo que se está corrigiendo, así que una orden reasignada arrastraría para siempre el motivo de su propio bloqueo: mesa operativa nueva y cero posibilidad de agregarle un plato. La mina se desactiva en el mismo paso que se arma; si G.2 entrara primero, el endpoint entregaría órdenes muertas.
- **Output:** guard reformulado en `orders.service.ts`; util puro `canReassignOrderToTable` con su `.spec.ts` (sin montar servicio); tres códigos dados de alta en `error-codes.ts` con su HTTP real y su `details` (`ORD_TABLE_REASSIGN_ORDER_STATE_001` con `details.state`, `ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001` con `details.reason`, y `TABLE_SESSION_NOT_FOUND` reutilizado para la orden que nunca vino de mesa). Nada de esto se cablea a una ruta todavía: la ruta es G.2.
- **Contracts touched:** FB-18, FB-50, DB-19, DB-20, ERR-06, ERR-29, ERR-30, ERR-31
- **Data impact:** none — el guard y el util solo LEEN (`table_sessions`, `payments`, `orders.active_financial_split_id`, `invoices`). Ninguna fila se escribe y ninguna columna cambia: `table_sessions.order_id` ya es no-único y el índice parcial `table_sessions_one_open_per_table` ya existe (migración `20260829094000`), así que este paso no necesita DDL.
- **Blast radius:** todo editor de orden con mesa detrás — `PUT /store/orders/:id/editor`, `PUT /store/orders/:id/items`, `POST /store/table-sessions/:id/add-items`. Si el guard se relaja de más, una cuenta ya cerrada y cobrada vuelve a ser editable y su `grand_total` puede caer por debajo de lo recaudado: lo nota contabilidad, tarde. Si se cierra de más, el mesero no puede agregar platos a una mesa viva: lo nota en el acto.
- **Rollback:** revertir el commit. El guard previo es una sola condición y el util nace sin llamadores fuera de su spec, así que la reversa no deja código huérfano ni dato que deshacer.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-cancellation-policy.util.spec.ts` — patrón de util puro que el spec nuevo replica
  - `npx jest --runInBand apps/backend/src/domains/store/orders/orders.service.spec.ts` con los cuatro casos: sin sesión, solo abierta, solo cerrada, cerrada + abierta
  - `curl -s -o evidence/G1-items-sesion-cerrada.json -w '%{http_code}' -X PUT "$API/store/orders/$ORDER_ID/items" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @items.json` → 409 con `errorCode` `ORD_EDIT_NOT_ALLOWED_001`
  - mismo `curl` sobre una orden con sesión abierta → 200, evidencia en `evidence/G1-items-sesion-abierta.json`
  - SQL de solo lectura: `SELECT order_id, count(*) FILTER (WHERE closed_at IS NULL) AS abiertas, count(*) AS total FROM table_sessions GROUP BY 1 HAVING count(*) > 1;` → `evidence/G1-sesiones-por-orden.txt`
- **Acceptance checklist:**
  - [x] El guard pregunta por sesión ABIERTA y sigue siendo idempotente cuando la orden nunca tuvo mesa (lookup nulo no es error)
  - [x] Orden con sesión cerrada y ninguna abierta: `PUT items` sigue devolviendo 409 `ORD_EDIT_NOT_ALLOWED_001`
  - [x] Orden con sesión cerrada MÁS una abierta: `PUT items` y `add-items` devuelven 200
  - [x] El util rechaza orden `cancelled`, `refunded`, con pago liquidado, con split activo o con factura emitida, y devuelve el motivo
  - [x] Los tres códigos están en `error-codes.ts` con HTTP real y con `details.state` / `details.reason` poblados
  - [x] Todo test de rechazo fija el `errorCode`; ninguno se conforma con `toBeInstanceOf(VendixHttpException)`
  - [x] Evidencia de los curl y del SQL guardada bajo `evidence/`
- **Status:** done · fox · 2026-09-24 · guard `:1570` + util puro + 409s verificados (107/107 + 19/19, `errorCode` fijo). Live: PUT #1184 cerrada-solo 409 `ORD_EDIT_NOT_ALLOWED_001`, PUT #1189 abierta 200; barrido 1 multi-sesión (#1192). Cerrada+abierta live difiere a G.2 (sin API pre-G.2 que cree ese estado). `G1-guard-live-20260924.md`.

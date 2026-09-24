---
id: A.4
title: "Borrador cancelable y rama de cancelación inalcanzable"
phase: A
status: in-progress
owner: mosk
updated: 2026-09-20
contracts: [FB-22, FB-24, DB-01, DB-16, DB-27, ERR-38, ERR-43]
adrs: []
skills: [vendix-backend, vendix-error-handling, vendix-inventory-stock, vendix-restaurant-ops, vendix-frontend, vendix-zoneless-signals, how-to-test]
---
# A.4 — Borrador cancelable y rama de cancelación inalcanzable

- **Skills:** `vendix-backend` (dos constantes en dos archivos y un claim atómico que no se puede aflojar) · `vendix-error-handling` (el rechazo actual es una `BadRequestException` cruda sin código) · `vendix-inventory-stock` (la cadena de efectos de `cancelOrder` libera reservas: sobre un borrador puede no haber ninguna) · `vendix-restaurant-ops` (abrir una mesa crea la orden en `draft`: el borrador cancelable toca el carril de mesa) · `vendix-frontend` y `vendix-zoneless-signals` (el botón existe en el menú de acciones y lo borra un filtro) · `how-to-test`.
- **Resources:** `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:56-72` (`VALID_TRANSITIONS`, con `draft: ['created','cancelled']` en `:57`), `:75-79` (`CANCELABLE_STATES` sin `draft`), `:2980` (`cancelOrder`), `:2985-2990` (`notCancelableError`, `BadRequestException` sin código tipado), `:3000-3002` (fast-path), `:3110` y `:3144` (claim atómico y su rechazo) · `apps/backend/src/domains/store/orders/order-flow/order-cancellation-policy.util.ts:32` (la SEGUNDA `CANCELABLE_STATES`, un `Set` con los mismos tres estados) y `:92-101` (`getOrderCancellationPolicy`) · `apps/backend/src/domains/store/orders/orders.service.ts:826` y `:1159` (los dos puntos donde la política viaja al frontend) · `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts:908-921` (el `case 'draft'` que empuja el botón Cancelar con un comentario que promete el comportamiento) y `:1090-1098` (`applyCancellationPolicy`, que lo borra) · `apps/backend/src/domains/store/tables/table-sessions.service.ts:363-386` (abrir mesa crea la orden con `state: 'draft'`) · registry `registry/fb.md` fila FB-22 · hub §Context (N9) y Objetivo Específico 2 · sin ADR: ver **Business decision**.
- **Business decision:** Un `draft` abandonado **se cancela desde la UI** conservando historial (hub N9). Carve-out pendiente de confirmación del dueño: si tiene sesión de mesa abierta, se cierra desde Mesas para no dejar la sesión apuntando a una orden cancelada. FB-22 rechaza borrado físico de un draft con líneas y dirige a `flow/cancel` (F-006), no a un 500 por FK.
- **Why:** La arista `draft → cancelled` existe en la máquina de estados (`:57`) y nadie puede recorrerla. `CANCELABLE_STATES` (`:75-79`) no incluye `draft`, así que el fast-path de `cancelOrder` lanza una `BadRequestException` cruda antes de llegar al claim: la rama es inalcanzable por construcción, no por permiso. El mismo conjunto está duplicado como `Set` en `order-cancellation-policy.util.ts:32`, que alimenta `cancellation_policy` en las dos respuestas de orden; por eso el frontend hace un movimiento contradictorio consigo mismo: el `case 'draft'` empuja el botón Cancelar con un comentario que dice *"`draft` behaves exactly like `created`: register payment, modify (privileged), cancel"*, y catorce líneas después `applyCancellationPolicy` lo filtra porque `can_cancel` llega en `false`. El cajero se queda con un borrador que no puede cerrar ni cancelar, y el único camino existente es `DELETE /store/orders/:id`, un borrado duro que destruye la evidencia de que la venta se intentó.
- **Output:** `draft` incorporado a las dos listas `CANCELABLE_STATES` (servicio y util), con una sola fuente si el ejecutor encuentra cómo compartirla sin ciclo de imports; guard nuevo `ORD_CANCEL_OPEN_TABLE_001` (ERR-43) que rechaza cancelar un `draft` con sesión de mesa abierta y manda a cerrar la cuenta desde Mesas; el botón Cancelar deja de ser filtrado para un borrador sin mesa; la cadena de efectos de `cancelOrder` se prueba sobre borrador sin reservas, pagos ni tickets; specs de ambos lados.
- **Contracts touched:** FB-22 (`DELETE` deja de ser el único camino), FB-24 (`flow/cancel` gana un estado de origen), DB-01 (`draft→cancelled`), DB-16 (sesión abierta impide cancelar), DB-27 (sin reservas no rompe liberación), ERR-38 (reversa de pago), ERR-43 (guard tipado de mesa abierta).
- **Data impact:** Escribe `orders.state = 'cancelled'` y su `internal_notes._flow_metadata` en las órdenes que un operador cancele deliberadamente, por la misma cadena de efectos que ya usan `created`, `pending_payment` y `processing`. Sin DDL, sin backfill y sin script masivo: ninguna orden cambia de estado por el solo hecho de desplegar el paso. Los borradores ya borrados en duro no se recuperan.
- **Blast radius:** El riesgo alto es el carril de mesa: si el guard de sesión abierta falta o se escribe mal, cancelar el borrador de una mesa deja la sesión abierta contra una orden `cancelled` y la mesa queda ocupada y sin salida; lo nota el mesero y el encargado al cierre. Riesgo medio: si la cadena de efectos asume reservas o pagos que un borrador no tiene, la cancelación revienta a medio camino y deja la orden en un estado intermedio. Riesgo bajo, pero real: exponer Cancelar donde antes no estaba invita a cancelar en vez de cobrar.
- **Rollback:** Revertir el commit: `draft` sale de las dos listas, la política vuelve a devolver `can_cancel:false` y el frontend vuelve a filtrar el botón. Las órdenes ya canceladas por esta vía **quedan canceladas** — `cancelled` sí tiene aristas de salida en `VALID_TRANSITIONS` (`pending_payment`, `created`, `processing`), de modo que se recuperan por el flujo de reactivación existente, una por una y con auditoría. No es una reversión silenciosa de datos.
- **Verification:**
  - `curl -sk -o ../evidence/A.4-cancel-draft.json -w '%{http_code}\n' -X POST "https://api.vendix.com/api/store/orders/$DRAFT_ORDER/flow/cancel" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"reason":"borrador abandonado"}'` (espera 200)
  - `curl -sk -o ../evidence/A.4-cancel-draft-con-mesa.json -w '%{http_code}\n' -X POST "https://api.vendix.com/api/store/orders/$TABLE_DRAFT/flow/cancel" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"reason":"prueba mesa abierta"}'` (espera rechazo tipado, no 200 y no 500)
  - `curl -sk -H "Authorization: Bearer $TOKEN" "https://api.vendix.com/api/store/orders/$DRAFT_ORDER" | tee ../evidence/A.4-policy.json | jq '.data.cancellation_policy'` (espera `can_cancel: true` para el borrador sin mesa)
  - `psql "$DATABASE_URL" -c "SELECT id, state, internal_notes FROM orders WHERE id=$DRAFT_ORDER;"`
  - `psql "$DATABASE_URL" -c "SELECT count(*) FROM stock_reservations WHERE reserved_for_type='order' AND reserved_for_id=$DRAFT_ORDER AND status='active';"` (0 antes y después: el borrador no reservaba)
  - `psql "$DATABASE_URL" -c "SELECT s.id, s.closed_at, o.state FROM table_sessions s JOIN orders o ON o.id=s.order_id WHERE s.closed_at IS NULL AND o.state='cancelled';"` (debe devolver 0 filas)
  - `npm --prefix apps/backend run test:path -- src/domains/store/orders/order-flow/order-flow.service.spec.ts`
  - `npm --prefix apps/backend run test:path -- src/domains/store/orders/order-flow/order-cancellation-policy.util.spec.ts`
  - `npm --prefix apps/backend run test:path -- src/domains/store/orders/order-flow/order-cancellation-race.integration.spec.ts`
  - Playwright MCP — abrir el detalle de un borrador POS abandonado, cancelarlo y confirmar que desaparece de la lista de pendientes; guardar en `evidence/A.4-e2e-borrador.md`
- **Acceptance checklist:**
  - [x] `draft` está en `CANCELABLE_STATES` del servicio y en el `Set` homónimo del util de política
  - [x] Las dos listas quedan sincronizadas y el paso deja constancia de cuál es la fuente
  - [x] El claim atómico conserva su `WHERE` condicional: dos cancelaciones concurrentes siguen teniendo un solo ganador
  - [x] Cancelar un `draft` sin mesa devuelve 200 y deja `orders.state='cancelled'`
  - [x] Cancelar un `draft` con sesión de mesa abierta se rechaza con código tipado y mensaje accionable
  - [x] ERR-43 `ORD_CANCEL_OPEN_TABLE_001` devuelve 409 antes del claim, con `details.table_session_id` y cero escrituras
  - [x] No queda ninguna fila con sesión abierta apuntando a una orden `cancelled`
  - [x] `cancellation_policy.can_cancel` llega en `true` para un borrador elegible en las dos respuestas de orden
  - [x] El botón Cancelar Orden es visible en el detalle de un borrador y su handler completa el flujo
  - [x] La cadena de efectos no falla sobre un borrador sin reservas, sin pagos y sin tickets de cocina
  - [x] El blocker de reversa de pago sigue disparando si el borrador tuviera un pago confirmado
  - [x] Hay un test que falla antes del fix probando la arista `draft → cancelled`
  - [x] Queda registrado como deuda que el rechazo por estado no cancelable sigue siendo una excepción sin código tipado
  - [x] FB-22 y FB-24 quedan marcadas con evidencia; DB-01/DB-27/ERR-38 siguen abiertas por sus invariantes compartidas de I/E
  - [x] F-005 — Falta contrato de error para cancelar draft con mesa abierta (major)
  - [x] F-006 — DELETE de borrador poblado retorna error tipado y no 500 (major)
- **Status:** in-progress · Fabio · 2026-09-23 · `d13ce5b79`, `1ed057bd5`; policy 46/46 y OrdersService 105/105. API: draft #1104 cancela 200, mesa abierta #1105 rechaza 409/cero writes (`evidence/A4-local-api-verification.md`). Playwright: POS draft #1135→detalle→Cancelar Orden→200, CANCELADA/historial (`evidence/A4-ui-draft-cancel.md`). FB-22: DELETE draft poblado y pagado 400 tipado, cancelación 200 (`evidence/A4-fb22-delete-guard.md`). `CANCELABLE_ORDER_STATES` es fuente única. Pendiente confirmación del dueño y DB-01/DB-27/ERR-38 con I/E.

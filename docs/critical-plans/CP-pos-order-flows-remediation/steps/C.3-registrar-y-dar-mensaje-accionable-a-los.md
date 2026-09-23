---
id: C.3
title: "Registrar y dar mensaje accionable a los códigos de cocina"
phase: C
status: in-progress
owner: Leibniz
updated: 2026-09-20
contracts: [ERR-07, ERR-08, ERR-09, ERR-10, ERR-11, ERR-12, ERR-13, FB-35, FB-41]
adrs: [ADR-06]
skills: [vendix-error-handling, vendix-restaurant-ops, vendix-frontend, how-to-test]
---
# C.3 — Registrar y dar mensaje accionable a los códigos de cocina

- **Skills:** `vendix-error-handling` (catálogo `error-codes.ts`, `VendixHttpException`, `parseApiError`, mapeo en `error-messages.ts`) · `vendix-restaurant-ops` (semántica de cada rechazo de cocina) · `vendix-frontend` (superficie que muestra el toast) · `how-to-test` (curl por código, test que fija `errorCode`).
- **Resources:** ADR-06 (los tres códigos «siguen existiendo para el KDS y se les da mensaje accionable en vez de eliminarlos») · `apps/backend/src/common/errors/error-codes.ts:5526` (`KDS_STATION_LOCKED`), `:5535` (`TABLE_SESSION_ITEM_NOT_DELIVERABLE`), `:5546` (`ORDER_ITEM_NOT_DELIVERABLE`) · `apps/backend/.../kitchen-fire/kitchen-fire.service.ts:80-85` (entrada **inline** `KITCHEN_TICKET_NOT_TAKEAWAY_ENTRY`, fuera del catálogo) y `:2611-2668` (los cinco rechazos de `markDelivered`) · `apps/frontend/src/app/core/utils/error-messages.ts:1028-1046` (bloque de cocina: sin `KDS_STATION_LOCKED`, sin `KITCHEN_TICKET_NOT_TAKEAWAY`, sin `ORDER_ITEM_NOT_DELIVERABLE`) · `apps/frontend/.../tables/services/tables.service.ts:292` (docblock que cita un código muerto) · registry `err.md` filas ERR-07..ERR-13.
- **Business decision:** ADR-06 no elimina ningún código: reduce su alcance. Tras C.1 el mesero ya no los alcanza, pero el KDS sí, y el cocinero merece saber qué hacer. La regla que fija este paso: **todo código que un operador puede provocar vive en el catálogo central y tiene un mensaje en español que dice la acción siguiente**, no la causa técnica. El único rechazo de entrega alcanzable desde mesa pasa a ser `ORDER_ITEM_NOT_DELIVERABLE` (ERR-12), con CTA al KDS.
- **Why:** hoy cuatro de los códigos implicados no tienen dónde mirarse. `KITCHEN_TICKET_NOT_TAKEAWAY` es un literal declarado dentro del servicio (`kitchen-fire.service.ts:80-85`) y **no existe en `error-codes.ts`**: ningún otro dominio puede referenciarlo y el frontend no puede mapearlo por constante. `KDS_STATION_LOCKED` sí está en el catálogo pero **no** en `error-messages.ts`, así que cae al texto genérico justo cuando el operador necesita saber que debe pedir cierre de turno o usar `force-take`. `ORDER_ITEM_NOT_DELIVERABLE` —que tras C.1 pasa a ser el rechazo principal— tampoco está mapeado. Y `TABLE_SESSION_ITEM_NOT_DELIVERABLE` está en el catálogo con **cero lanzadores** en todo el backend, mientras el docblock del servicio de mesa del frontend lo cita como si fuera el código vivo: el frontend espera un código que nunca llega.
- **Output:** `KITCHEN_TICKET_NOT_TAKEAWAY` migrado a `error-codes.ts` con el mismo `code` y `httpStatus` (el literal del servicio pasa a referenciar la entrada del catálogo, sin cambiar el contrato HTTP); cuatro mensajes nuevos en `error-messages.ts` (`KDS_STATION_LOCKED`, `KITCHEN_TICKET_NOT_TAKEAWAY`, `ORDER_ITEM_NOT_DELIVERABLE`, y el texto de `KITCHEN_TICKET_ALREADY_DELIVERED` revisado para el caso idempotente); el docblock de `tables.service.ts:292` corregido para citar el código real; la entrada muerta del catálogo marcada como deprecada con puntero al vigente.
- **Contracts touched:** ERR-07 (mensaje accionable con salida `force-take`), ERR-08 (migrado al catálogo), ERR-09, ERR-10 y ERR-11 (textos revisados), ERR-12 (mensaje nuevo, rechazo principal tras ADR-06), ERR-13 (entrada muerta, el frontend deja de citarla), FB-35 (los tres verbos de ticket comparten el guard de estación), FB-41 (`force-take` como única salida del lock).
- **Data impact:** none — el paso solo mueve una definición de error de un archivo a otro y añade cadenas de UI. Ninguna fila escrita, ninguna migración.
- **Blast radius:** toasts del KDS y de la página de mesa. Si la migración del literal cambia `code` o `httpStatus`, se rompe `kitchen-fire.service.spec.ts:1176`, que ya fija ese `errorCode`, y cualquier cliente que ramifique por el código. Quien lo nota: el cocinero (mensaje equivocado) y el test (rojo inmediato). Señal de detección: aparición de `SYS_INTERNAL_001` o del texto genérico por defecto en los recorridos de cocina.
- **Rollback:** trivial y sin dato. Revertir el commit restituye la entrada inline y los mensajes previos; nada que reparar en base de datos.
- **Verification:**
  - `grep -n "KITCHEN_TICKET_NOT_TAKEAWAY" apps/backend/src/common/errors/error-codes.ts` → ≥ 1 hit (hoy 0).
  - `npx jest --runInBand apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.spec.ts` — el spec que ya fija ese `errorCode` sigue verde sin editarlo.
  - `grep -rn "TABLE_SESSION_ITEM_NOT_DELIVERABLE" apps/backend/src --include='*.ts' | grep -v error-codes.ts` → 0 lanzadores, confirmado y documentado.
  - `for C in KDS_STATION_LOCKED KITCHEN_TICKET_NOT_TAKEAWAY ORDER_ITEM_NOT_DELIVERABLE; do grep -c "$C" apps/frontend/src/app/core/utils/error-messages.ts; done > evidence/C.3-mapeos-frontend.txt` → tres valores ≥ 1.
  - `curl -s -X POST "$API/store/kitchen-fire/tickets/$TID_MIXTO/delivered" -H "Authorization: Bearer $TOKEN_COCINA" -o evidence/C.3-not-takeaway.json -w '%{http_code}\n'` → 422 con `errorCode: KITCHEN_TICKET_NOT_TAKEAWAY`.
  - `curl -s -X POST "$API/store/kitchen-fire/tickets/$TID/start" -H "Authorization: Bearer $TOKEN_OTRO" -o evidence/C.3-station-locked.json -w '%{http_code}\n'` → 403 con `errorCode: KDS_STATION_LOCKED`.
  - `curl -s -X PATCH "$API/store/table-sessions/$SID/items/$IID_NO_READY/deliver" -H "Authorization: Bearer $TOKEN_MESERO" -o evidence/C.3-item-not-deliverable.json -w '%{http_code}\n'` → 409 con `errorCode: ORDER_ITEM_NOT_DELIVERABLE`.
  - Playwright MCP: provocar los tres rechazos y capturar el toast visible en `evidence/C.3-toasts/`.
- **Acceptance checklist:**
  - [x] `KITCHEN_TICKET_NOT_TAKEAWAY` vive en `error-codes.ts` con el mismo `code` y el mismo HTTP 422 que tenía inline.
  - [x] El spec de cocina que fija ese `errorCode` pasa sin modificarlo: la migración no cambió el contrato.
  - [x] `KDS_STATION_LOCKED`, `KITCHEN_TICKET_NOT_TAKEAWAY` y `ORDER_ITEM_NOT_DELIVERABLE` tienen mensaje en `error-messages.ts`.
  - [x] El mensaje de estación bloqueada nombra la salida concreta: pedir cierre de turno o tomar la estación.
  - [x] El mensaje de plato no listo lleva al KDS, no describe el estado interno del ticket.
  - [x] El docblock del servicio de mesa del frontend cita el código realmente lanzado, no la entrada muerta.
  - [x] La entrada sin lanzadores queda marcada como deprecada con puntero al código vigente; sigue en 0 lanzadores.
  - [x] Los tres rechazos se provocan por curl y ninguno devuelve 500 ni cae al texto genérico.
  - [ ] Playwright muestra toasts accionables de lock, ticket no-takeaway y plato no listo en sus superficies reales.
- **Status:** in-progress · Fabio · 2026-09-23 · `evidence/C3-http-rejection.md` y `C3-station-lock-and-codes-20260923.md`: fixture aislado en Barra #7 probó HTTP403 `KDS_STATION_LOCKED` sin atribuir consumos huérfanos; not-takeaway 422, not-ready/already-delivered/already-cancelled e ítem no listo 409, sin mutación. Jest cocina 33/33, controller 1/1, Angular error-messages 20/20. Falta Playwright de toasts en superficies reales; ADR-06 sigue proposed.

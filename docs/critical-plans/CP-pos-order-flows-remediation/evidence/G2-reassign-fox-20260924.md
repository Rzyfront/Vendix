# G.2 — Reasignación live fox (2026-09-24, tienda roku #10)

Suma a `G2-reassign-backend/runtime-20260923.md` (previos): happy live con
tickets KDS reales + matriz completa de rechazos + invariantes SQL + UI
verificada por lectura. E2E visual con login: HALT boss — lo corre boss.

## Happy: orden #1189 (draft) → mesa 27

1. `POST table-sessions/125/close` → 201 (sesión origen cerrada).
2. `POST table-sessions/reassign {1189, 27}` → **201**, misma orden, sesión
   nueva **#129**, `opened_by=162` (reassigner, ADR-04). (`G2-reassign-ok.json`)
3. Invariantes SQL (`G2-invariantes.txt`): 1 abierta + 2 total; orden intacta
   (id/número/state); tickets #113/#114 re-estampados 26→**27** (KDS real);
   `inventory_consumed_at_fire` t/t sin cambios (sin re-disparo); mesa 27
   `occupied`, 26 `cleaning`.
4. `PUT orders/1189/items` → **200** + `POST table-sessions/129/add-items` →
   **201** (cierra el loop G.1 cerrada+abierta live).

## Rechazos live (cero filas nuevas en cada uno)

| Caso | Esperado | Obtenido |
|---|---|---|
| destino ocupada (23) | 409 tipado | 409 `TABLE_SESSION_ALREADY_OPEN`, count 2 (`G2-reassign-ocupada.json`) |
| destino reserved (28, ciclo PATCH) | 409 `TABLE_INVALID_STATUS` | 409, count 2, mesa devuelta a available (`G2-reassign-reservada.json`) |
| orden cancelled #1192 | 409 + `details.state` | 409 `ORD_TABLE_REASSIGN_ORDER_STATE_001` (`G2-reassign-cancelada.json`) |
| orden sin mesa #1198 | 404 tipado | 404 `TABLE_SESSION_NOT_FOUND` (`G2-reassign-sintabla.json`) |
| cobrada #1132 | 409 + `reason=settled_payment` | 409 `ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001` (`G2-reassign-cobrada.json`) |
| split #1178 | 409 + reason | 409 `..._NOT_ELIGIBLE_001`, `settled_payment` (chequeo previo al split) |
| campo no declarado | 422/400 `SYS_VALIDATION_001` | **400** (no 422): pipe global Nest; código + `details.validationErrors` OK |
| transfer origen cerrado (26→28) | rechazo tipado | 404 `TABLE_SESSION_NOT_FOUND` (`G2-transfer-cerrado.json`, FB-48) |

## Specs + UI (sin browser por HALT)

- `table-sessions.service.spec.ts` **77/77** (`G.2-spec.txt`): libre/ocupada/
  reserved/cobrada/sin-previa + `it.each(cancelled,refunded)` + 3 reasons
  financieros, todos fijando `errorCode`.
- Modal traslado modo `reassign`: signals/computed, solo `available`
  habilitado, ocupadas excluidas, `orderId` requerido, preview explica sesión
  nueva + cierre conservado. Cliente `reassignOrderToTable` +
  `getOrderReassignmentEvidence`. Mensajes FE cubren los 5 rechazos
  (`error-messages.ts:1096-1113`). Angular 22/22 previo (042b5aa5b).

## Notas honestas

- ERR-42 flipped parcial: mitad reasignar probada (código+details; status
  real 400 vs 422 del registry — comportamiento global del pipe, fuera de
  alcance); mitad `destination:reuse` (ADR-08) es de fase D. Fila queda `[ ]`
  con evidencia enlazada hasta D.
- ERR-30: live 1/3 razones (`settled_payment` ×2); split/factura por spec
  (insumo live inexistente en dev). Flip con esta nota.
- DB-11: reassign no muta flags (probado); fila global queda `[ ]` (resto es
  de fase D/inventario).
- `order-lifecycle-lock.util.ts` existe y el endpoint lo toma (dependencia OK).

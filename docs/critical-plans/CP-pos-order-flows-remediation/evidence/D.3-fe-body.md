# D.3 frontend disposition wiring — resumen ejecutor FE

Fecha (UTC): 2026-09-24T01:40Z · Rama: develop · HEAD: 336501d0b

## 1. Archivos cambiados (cambio real: 1)

- `apps/frontend/src/app/private/modules/store/orders/services/orders.service.ts`
  (+19/−6): `cancelOrderItem` body `{reason}` → `{reason, cancellation_type?}` con
  `'before_fire'|'after_fire_waste'|'after_fire_reused'` + JSDoc (vocabulario = `tables.service.ts:279`).
  Passthrough al PATCH ya existía (`body` se reenvía intacto); cambio 100% backward-compatible
  (prop opcional; llamador legacy `:4165` con `{reason}` sigue compilando).
- NO tocado (prohibido/sucio): `order-details-page.component.ts` — ver §3, no requiere edit.
- Evidencia nueva (3, este dir): `D.3-fb29-grep.txt`, `D.3-mesa-vista.md`, `D.3-fe-body.md`.

## 2. Watch (buildcheck-dev)

- `bash scripts/buildcheck.sh --watch` → `ng serve ACTIVO (pid 85589)` + `último ciclo OK hace 3s`
  + `errores ninguno` — ciclo POSTERIOR al edit (primer chequeo dio OK hace 966s = pre-edit;
  tras 50s el watcher recompiló y re-verifiqué). Estado: **OK**. Nada reiniciado.

## 3. FB-26 — mapeo modal→service (verificación de cadena completa)

- Modal (6131c702a, html:2507-2580): captura `cancellationDestination` ('waste'|'reuse', radios)
  + `cancellationReason` (textarea 3-500) → `submitItemCancellation()` (:4232).
- Mapeo `cancellationBody()` (:210-222): cancel+fired → `{reason, cancellation_type:
  after_fire_reused|after_fire_waste}`; cancel+no-fired → `{reason}`; reverse → `{reason,
  destination: restock|waste}`. Gate reuse: `canReuseCancellation()` (:4065-4066) =
  `mode==='reverse' || cancellationPreparedFired()` → reuse habilitado en cancel solo si
  prepared+`inventory_consumed_at_fire`. Todo esto YA commiteado (2431a1152); el único eslabón
  roto era el tipo del service, que este D.3 cierra.
- Llamador: `ordersFlowService` ES `OrdersService` (alias `inject` en :1474); `:4255` pasa `body`
  directo. **Diff pendiente en order-details: NINGUNO.** (Nits no tocados: try/catch en :4243 ya
  inalcanzable pues `cancellationBody` no tira; `Observable` import solo usado en :4250.)

## 4. FB-29 — veredicto

**Sin llamadores nuevos.** DELETE legacy `table-sessions/:id/items/:orderItemId` solo existe como
definición (`tables.service.ts:244-253`, `removeItem`, http.delete en :246) con 0 invocaciones en
todo `apps/frontend`. Flujo activo único: POST `/cancel` desde `table-session-page:1102`. Detalle +
salidas literales en `D.3-fb29-grep.txt`. `removeItem` = muerto, candidato a borrado futuro (fuera de D.3).

## 5. Ítem 7 — veredicto

**OK sin edits.** Tipo vista (`table.interface.ts:237`) admite las 5 variantes + null; badge muestra
"Cancelado · merma / · reuso" + motivo (html:436-458). Mesa manda `{reason}` y backend decide tipo
(diseño consciente, distinto de order-details que sí pide destino). Nota en `D.3-mesa-vista.md`.

# C.3 — Receta E2E lista para orquestador (HALT login: la corre boss)

- Fecha: 2026-09-24 · Preparado por: toss · HALT usuario vigente: peers sin
  E2E-login; curl/specs permitidos. Tienda #10 (Roku), `x-store-id: 10`.
- Precondición: `ng serve` ARRIBA (estaba CAÍDO/RANCIO al preparar esto) +
  backend `/api/health` OK. Cuentas seed (clave `1125634q`): mesero
  `mesero.e2e@roku.test` (#241), cocinero `cocina.e2e@roku.test` (#242).
- NO usar mesas #27/#28 (QA-G2, G.2 in-progress) ni tocar fixtures ajenos.

## S1 — toast lock KDS (ERR-07), tablero como mesero

Hallazgo previo: el mesero SÍ abre `/admin/restaurant-ops/kds` (guard =
`store:kitchen_fire:read`, que tiene; `kds:read` solo protege configuracion).

1. Mesero crea orden mostrador: `POST /store/orders`
   `{subtotal:15000,total_amount:15000,items:[{product_id:333,
   product_name:"Hamburguesa Artesanal",quantity:1,unit_price:15000,
   total_price:15000}]}` → OID/IID.
2. Mesero dispara: `POST /store/kitchen-fire {order_id:OID,
   order_item_ids:[IID]}` → TID (Cocina #1 por defecto, pending, COGS 0).
3. Cocinero abre turno: `POST /store/kds-sessions/open {kds_id:1}` → 201
   (si 409 hay turno ajeno: abortar, no force-take).
4. Playwright mesero: login `https://vendix.com` (org slug `roku`) →
   directo a `/admin/restaurant-ops/kds` → clic Start sobre TID.
   ESPERADO: toast error con mensaje mapeado de `KDS_STATION_LOCKED`
   (ver texto en `error-messages.ts`: cerrar turno/tomar estación),
   HTTP 403 en network, 0 errores JS, ticket sigue `pending`.
5. Evidencia: screenshot → `evidence/C.3-lock-toast.png` + nota
   `evidence/C.3-lock-toast.md` (texto toast + code + http).
6. Limpieza: cocinero `POST /store/kds-sessions/<sid>/close`;
   mesero `POST /store/orders/<OID>/flow/cancel
   {reason:"...",kitchenDisposition:"waste"}` → 200.
   (Abrir/cerrar turno Cocina NO atribuye huérfanos: `close()` solo lee
   summary por sesión, verificado en código.)

## Survey — prevención UI (solo lectura, KDS como cocinero)

Inspeccionar botones por estado (sin clics en tickets ajenos) y tabular en
`evidence/C.3-prevention-survey.md`: 422 takeaway-only (ticket mesa/mixto
ready: ¿deliver ausente/deshabilitado?), 409 NOT_READY (pending),
409 ALREADY_DELIVERED (delivered), 409 ALREADY_CANCELLED (cancelled).

## S2(b) — toast 409 plato-no-listo (ERR-12), detalle-orden (sustitución)

Motivo sustitución (aprobada boss): superficie mesa exige carrera
(`canDeliver` oculta botón salvo ready) + 0 mesas libres (G.2 ocupa
#27/#28). Mini-fix aplicado (toss, sin verificar compilación por ng
caído): `deliverItem` en `order-details-page.component.ts` usa
`parseApiError(err).userMessage` con fallback al texto previo.

1. Fixture: orden mostrador + fire (como S1 pasos 1-2), SIN ready
   (ticket pending). NO abrir turno (no se necesita).
2. Playwright mesero: abrir detalle de la orden → clic entregar sobre
   la línea no-lista. ESPERADO: toast con mensaje mapeado de
   `ORDER_ITEM_NOT_DELIVERABLE` ("Cocina aún no marca este plato como
   listo."), HTTP 409 en network.
3. Evidencia: screenshot + nota `evidence/C.3-409-toast.md`.
4. Limpieza: cancelar orden con `kitchenDisposition:"waste"`.
5. Deuda explícita S2-mesa: toast 409 en superficie mesa queda pendiente
   (requiere mesa libre o carrera ready→revertida).

## 422 + ERR-09/10/11 — ajuste explícito propuesto

Si el survey confirma prevención total por diseño (botón ausente o
deshabilitado con motivo), el criterio "toast real" para esos códigos se
declara N/A-por-diseño: la UI impide la acción (mejor UX que el toast) y
el código+mensaje quedan probados por curl (`C3-*.md` existentes).
Decisión final del orquestador/dueño al cerrar C.3.

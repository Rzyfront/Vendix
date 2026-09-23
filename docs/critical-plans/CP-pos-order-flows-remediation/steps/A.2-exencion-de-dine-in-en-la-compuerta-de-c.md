---
id: A.2
title: "Exención de dine_in en la compuerta de cobro de envío"
phase: A
status: pending
owner: none
updated: 2026-09-20
contracts: [FB-04, FB-05, FB-20, ERR-03]
adrs: []
skills: [vendix-backend, vendix-error-handling, vendix-restaurant-ops, vendix-frontend, vendix-zoneless-signals, how-to-test]
---
# A.2 — Exención de dine_in en la compuerta de cobro de envío

- **Skills:** `vendix-backend` (la compuerta vive en `payOrder`, antes del claim atómico: se toca la condición, no el orden de las operaciones) · `vendix-error-handling` (`ORD_SHIP_CHARGE_001` ya está en el catálogo; el paso cambia su alcance y su mensaje, no su código) · `vendix-restaurant-ops` (quién produce órdenes `dine_in` y por qué una mesa no se despacha) · `vendix-frontend` y `vendix-zoneless-signals` (el `computed()` que apaga el botón de cobro en el detalle de orden) · `how-to-test` (happy/sad/brute-force sobre los cuatro carriles de cobro).
- **Resources:** `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:646` (`payOrder`), `:665-682` (la compuerta: `needsDispatch` exime `pickup` y `direct_delivery` y nada más) y `:680` (el `throw ORD_SHIP_CHARGE_001`) · `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:3761` (`registerCreditPayment`, carril de fiado — ver **Why**) · `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts:695-701` (`blockedByMissingShipping`, que exime `direct_delivery` y `other`), `:875-885` (con ese flag las acciones se reducen a Cancelar) y `:736` · `apps/frontend/src/app/private/modules/store/orders/services/store-orders.service.ts:515` y `:528` · `apps/frontend/src/app/core/utils/error-messages.ts` (mapa código→mensaje) · registry `registry/err.md` fila ERR-03 y `registry/fb.md` filas FB-04, FB-05, FB-20 · hub §Context ("una orden de mesa **no se puede cobrar** desde el detalle") y Objetivo Específico 2 · sin ADR: ver **Business decision**. ADR-01 describe la lista de exención actual como contexto, pero decide sobre «llevar», no sobre mesa.
- **Business decision:** Una orden `dine_in` se consume en el local: no genera despacho y por tanto **no exige método de envío para cobrarse**. No hubo alternativas de negocio que decidir —nadie propuso cobrar envío a una mesa—, así que no tiene ADR propio: el hub lo fija como Objetivo Específico 2 y la compuerta se acota a su alcance declarado. La compuerta se conserva intacta para `home_delivery` y `other`: este paso **acota**, no desarma.
- **Why:** La compuerta de `payOrder` nació para impedir cobrar un domicilio sin método de envío, y su lista de exentos se escribió antes de que existieran las órdenes de mesa: exime `pickup` y `direct_delivery` y deja caer `dine_in` dentro de `needsDispatch`. Como la orden de mesa tiene ítems físicos y nunca lleva `shipping_method_id`, todo cobro por el detalle de orden muere en 422. El frontend agrava el síntoma con una segunda lista divergente: `blockedByMissingShipping` exime `direct_delivery` y `other` —ni siquiera `pickup`—, y cuando devuelve `true` el menú de acciones se reduce a Cancelar, de modo que el botón de Registrar Pago ni aparece. Dos listas de exención en dos capas, ninguna de ellas con `dine_in`, y el mesero se queda con una cuenta que solo se cierra sin constancia de pago.
- **Output:** La condición de `needsDispatch` exime también `dine_in`, con el comentario que explica por qué y una fuente única de la lista de exentos para que backend y frontend no vuelvan a divergir; `blockedByMissingShipping` pasa a usar esa misma lista (y gana `pickup`, que hoy le falta); `ORD_SHIP_CHARGE_001` recibe mensaje accionable en `error-messages.ts` ("Elige el método de envío antes de cobrar."); tests de backend que fijan el `errorCode` sobre `home_delivery` sin método y su ausencia sobre `dine_in`.
- **Contracts touched:** FB-04 (`flow/pay` sobre `dine_in` pasa a 200), FB-05 (se verifica que el fiado no herede el 422 — hoy no lo tiene), FB-20 (`PATCH .../shipping` sigue siendo la salida del 422 para los tipos que sí despachan), ERR-03 (alcance y mensaje del código).
- **Data impact:** none — el paso cambia una condición de lectura previa al claim atómico y un `computed()` del frontend. No escribe ninguna fila, no requiere DDL y no repara datos históricos. El efecto observable es que órdenes `dine_in` que hoy no se podían cobrar pasan a producir sus filas normales de `payments`, por el carril que ya existe.
- **Blast radius:** Si la exención se escribe demasiado ancha (por ejemplo eximiendo por "no tiene método asignado" en vez de por tipo de entrega), un domicilio real se cobra sin método de envío y después no se puede despachar: lo nota el despachador con `DSP_ORDER_DELIVERY_001` y el cliente con un pedido que nadie sale a entregar. Si se escribe demasiado estrecha, la mesa sigue sin cobrarse y el defecto persiste. La compuerta es previa al claim y de solo lectura, así que un rechazo no deja nada escrito a medias.
- **Rollback:** Revertir el commit del paso: la lista de exentos vuelve a `pickup`/`direct_delivery` y el `computed()` del frontend a su forma anterior. Sin escritura de datos, la reversión es completa e inmediata. Es independiente de A.1, A.3 y A.4, como fija la tabla de Rollback del hub para la fase A.
- **Verification:**
  - `curl -sk -o ../evidence/A.2-flowpay-dinein.json -w '%{http_code}\n' -X POST "https://api.vendix.com/api/store/orders/$DINE_IN_ORDER/flow/pay" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"store_payment_method_id":1,"payment_type":"direct"}'` (espera 200)
  - `curl -sk -o ../evidence/A.2-flowpay-home-delivery.json -w '%{http_code}\n' -X POST "https://api.vendix.com/api/store/orders/$HOME_ORDER/flow/pay" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"store_payment_method_id":1,"payment_type":"direct"}'` (espera 422 con `errorCode: ORD_SHIP_CHARGE_001`)
  - `curl -sk -o ../evidence/A.2-shipping-then-pay.json -w '%{http_code}\n' -X PATCH "https://api.vendix.com/api/store/orders/$HOME_ORDER/shipping" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"shipping_method_id":1}'` y repetir el `flow/pay` anterior (espera 200)
  - `curl -sk -o ../evidence/A.2-credit-payment.json -w '%{http_code}\n' -X POST "https://api.vendix.com/api/store/orders/$DINE_IN_ORDER/flow/credit-payment" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"store_payment_method_id":1}'`
  - `psql "$DATABASE_URL" -c "SELECT delivery_type, shipping_method_id, state FROM orders WHERE id IN ($DINE_IN_ORDER,$HOME_ORDER);"`
  - `npm --prefix apps/backend run test:path -- src/domains/store/orders/order-flow/order-flow.service.spec.ts`
  - `grep -rn "delivery_type !== 'pickup'" apps/backend/src apps/frontend/src` → una sola definición de la lista de exentos por capa, documentada y cruzada
  - Playwright MCP — abrir mesa, pedir, y cobrar desde el detalle de la orden: la acción Registrar Pago debe estar visible y el cobro terminar en 200; guardar el recorrido en `evidence/A.2-e2e-detalle-mesa.md`
- **Acceptance checklist:**
  - [ ] `needsDispatch` exime `dine_in` además de `pickup` y `direct_delivery`, con comentario que cita el objetivo del hub
  - [ ] La compuerta sigue lanzando 422 sobre `home_delivery` sin `shipping_method_id`
  - [ ] La compuerta sigue siendo previa al claim atómico y de solo lectura: un rechazo no escribe nada
  - [ ] `assertNoActiveFinancialSplit` sigue ejecutándose en el mismo bloque y antes del claim
  - [ ] `blockedByMissingShipping` usa la misma lista de exentos que el backend e incluye `dine_in` y `pickup`
  - [ ] Con una orden `dine_in` el menú de acciones del detalle muestra Registrar Pago y no el alert de método de envío
  - [ ] `error-messages.ts` mapea `ORD_SHIP_CHARGE_001` a un mensaje accionable en español
  - [ ] Hay un test que falla antes del fix y que fija `errorCode` sobre `home_delivery` sin método de envío
  - [ ] Hay un test que afirma la AUSENCIA de `ORD_SHIP_CHARGE_001` al cobrar una orden `dine_in`
  - [ ] `registerCreditPayment` no adquiere la compuerta: el fiado sobre mesa responde sin 422 de envío
  - [ ] Los cuatro carriles de cobro quedan verificados con su evidencia en `evidence/`
  - [ ] Las filas FB-04, FB-05, FB-20 y ERR-03 quedan marcadas con su evidencia enlazada
- **Status:** pending

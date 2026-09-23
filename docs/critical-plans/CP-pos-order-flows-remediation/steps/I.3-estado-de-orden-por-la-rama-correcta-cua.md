---
id: I.3
title: "Estado de orden por la rama correcta cuando el pago queda pendiente"
phase: I
status: in-progress
owner: Hypatia
updated: 2026-09-20
contracts: [FB-01, DB-03, DB-14, ERR-20]
adrs: []
skills: [vendix-backend, vendix-payment-processors, vendix-error-handling, how-to-test]
---
# I.3 — Estado de orden por la rama correcta cuando el pago queda pendiente

- **Skills:** `vendix-backend` (la bifurcación vive en el servicio de pagos) · `vendix-payment-processors` (el discriminador correcto es `system_payment_methods.processing_mode`, no una lista de nombres; el processor de contra-entrega ya está registrado) · `vendix-error-handling` (el estado resultante determina qué código ve después el despacho) · `how-to-test` (contra-entrega a domicilio y contra-entrega de mostrador, más Wompi como caso de control).
- **Resources:** `apps/backend/src/domains/store/payments/payments.service.ts:3463-3474` (`isDeferredDigitalMethod`, que sigue mirando `['wompi','wallet']`) · `:3480-3500` (el discriminador correcto por `processing_mode === ON_DELIVERY`, ya adoptado para el PAGO) · `:1352-1375` (la bifurcación que decide el estado de la orden y toma la rama `succeeded`) · `:4562` y `:4591` (el pago nace `pending` y se conserva el saldo con abono de cero) · `apps/backend/src/domains/store/payments/payments.module.ts:152` (processor registrado y nunca invocado) · `apps/frontend/src/app/private/modules/store/pos/services/pos-payment.service.ts:626-630` (comentario que afirma lo contrario de lo que hace el backend) · ficha de origen `F-014` (parcialmente cerrada por `31c8f5149`).
- **Business decision:** el estado de la orden lo decide **el mismo discriminador que ya decide el estado del pago**. Una contra-entrega deja la orden en `pending_payment`, con su saldo vivo, tanto si es a domicilio como si es de mostrador. Deja de existir una segunda bifurcación que clasifica métodos por nombre.
- **Why:** el lado del pago sí se arregló: el discriminador pasó a `processing_mode` y el pago de una contra-entrega nace `pending` conservando el saldo. Pero el estado de la ORDEN se decide por otra bifurcación, `isDeferredDigitalMethod`, que sigue mirando una lista literal de dos nombres. El resultado observable es una orden `finished` con el pago `pending` y `remaining_balance = grand_total`: una venta que el sistema da por terminada y por la que nadie cobró. Y como `finished` no está entre los estados que admiten remisión, esa venta tampoco se puede despachar. Dos bifurcaciones para un mismo hecho: la divergencia es el defecto.
- **Output:** una sola derivación del modo de liquidación, leída desde `system_payment_methods.processing_mode` y consumida por las dos decisiones (estado del pago y estado de la orden); la bifurcación por lista de nombres retirada del camino del estado de la orden; y el comentario del cliente POS corregido para que describa la conducta real del backend. El processor COD queda registrado para `PaymentGatewayService`/API genérica; el POS conserva su escritura transaccional del pago `pending` y no necesita invocarlo. Desregistrarlo rompería ese otro carril.
- **Contracts touched:** FB-01, DB-03, DB-14, ERR-20
- **Data impact:** escribe `orders.state` — una contra-entrega nueva nace `pending_payment` en vez de `finished`. No reescribe ninguna orden histórica: el cambio es hacia adelante. `payments.state`, `total_paid` y `remaining_balance` conservan la conducta ya corregida. Sin migración: `processing_mode` ya existe en `system_payment_methods`.
- **Blast radius:** toda venta cobrada con un método de liquidación en entrega, y aguas abajo el despacho (una orden `pending_payment` sí admite remisión, una `finished` no) y la analítica de ventas completadas. Si el cambio se aplica de más, ventas de contado podrían quedar en `pending_payment` y aparecerían como pendientes de cobro: lo nota el cajero y lo nota el dashboard. Si se aplica de menos, sigue habiendo ventas dadas por terminadas sin dinero detrás: lo nota cartera cuando nadie cobra.
- **Rollback:** revertir el commit devuelve la bifurcación por lista de nombres. Las órdenes que ya nacieron `pending_payment` siguen siendo coherentes con sus pagos pendientes y no requieren corrección; ninguna fila histórica se tocó.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/payments/payments.service.spec.ts` — contra-entrega a domicilio, contra-entrega de mostrador, Wompi y efectivo: cuatro estados esperados distintos y explícitos
  - `curl -s -o evidence/I3-cod-mostrador.json -w '%{http_code}' -X POST "$API/store/payments/pos" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @cod-mostrador.json` → 200 con `order.state == "pending_payment"`
  - `curl … -d @cod-domicilio.json -o evidence/I3-cod-domicilio.json` → mismo estado que el de mostrador
  - `curl … -d @efectivo.json -o evidence/I3-efectivo.json` → conducta de hoy, sin cambio
  - SQL de solo lectura: `SELECT o.id, o.state, o.remaining_balance, p.state FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.created_at > :deploy AND p.state = 'pending';` → ninguna fila con `o.state = 'finished'`, evidencia en `evidence/I3-estado-vs-pago.txt`
  - `curl -s "$API/store/dispatch-notes/from-order/$ORDER_ID" …` sobre la contra-entrega → ya no rechaza por estado, evidencia en `evidence/I3-remision.json`
- **Acceptance checklist:**
  - [ ] El estado de la orden y el del pago se derivan del mismo dato de método, sin segunda bifurcación por nombre
  - [ ] Una contra-entrega de mostrador termina con saldo vivo y no como venta terminada
  - [ ] Una contra-entrega a domicilio termina en el mismo estado que la de mostrador
  - [ ] Efectivo, tarjeta y pasarela conservan exactamente su conducta actual
  - [ ] Ninguna orden histórica se reescribe: el cambio solo afecta a ventas nuevas
  - [ ] El comentario del cliente POS describe la conducta real del backend
  - [ ] El procesador COD sigue registrado para el gateway genérico; POS escribe pending de forma transaccional sin invocarlo, y la razón queda documentada
  - [ ] La consulta que cruza estado de orden contra estado de pago no devuelve ninguna venta terminada sin cobro
- **Status:** in-progress — 88235b0e2; COD mostrador 201 con orden/pago pendientes y saldo vivo; falta domicilio/remisión.

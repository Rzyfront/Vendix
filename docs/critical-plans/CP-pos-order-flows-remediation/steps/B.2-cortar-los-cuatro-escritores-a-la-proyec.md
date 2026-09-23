---
id: B.2
title: "Cortar los cuatro escritores a la proyección canónica"
phase: B
status: in-progress
owner: Fabio
updated: 2026-09-20
contracts: [FB-03, FB-04, FB-11, FB-12, FB-53, DB-17, DB-18, DB-21, ERR-05, ERR-33]
adrs: [ADR-03]
skills: [vendix-backend, vendix-restaurant-ops, vendix-payment-processors, vendix-error-handling, how-to-test]
---
# B.2 — Cortar los cuatro escritores a la proyección canónica

- **Skills:** `vendix-backend` · `vendix-restaurant-ops` (la mesa no se cierra al cobrar) · `vendix-payment-processors` (el carril del webhook es el que más cambia y es el único asíncrono) · `vendix-error-handling` (la proyección no puede tumbar un cobro ya cometido) · `how-to-test`.
- **Resources:** ADR-03 (decisión y lista de los cuatro escritores) · B.1 (la función canónica ya existe y está sin llamadores) · Escritor 1: `apps/backend/src/domains/store/payments/payments.service.ts:3828` (`markSessionPaid` en tx), `:1983` (`emitSessionPaid` post-commit), `:3937` (`closedSessionId` fijo en `null`) · Escritor 2: `apps/backend/src/domains/store/tables/split-account-payment.service.ts:556` y `:572` · Escritor 3: `apps/backend/src/domains/store/payments/services/webhook-handler.service.ts:601-660`, en particular `:628-631` (busca la sesión abierta) y `:634` (`closeSession`, que manda la mesa a `cleaning` y **nunca escribe `paid_at`**) · Escritor 4: `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:646` (`payOrder`, que no proyecta nada) · quinto escritor potencial a auditar: el confirm de pago de sesión (FB-53) y el de cuenta de split (FB-12) · `registry/err.md` filas ERR-05 y ERR-33 · ficha de origen `F-026` (el cuarto escritor, `payOrder`, que no proyecta nada).
- **Business decision:** Los cuatro carriles de cobro producen **el mismo efecto** sobre la mesa: cuenta pagada, mesa ocupada. Lo fija ADR-03 con decisión del dueño del 2026-09-20. La consecuencia explícita que este paso ejecuta es que **el pago en línea deja de cerrar la mesa**: hoy un cliente que paga por pasarela desde la mesa ve su mesa pasar a limpieza mientras sigue sentado, y eso era la divergencia más peligrosa de las cuatro.
- **Why:** Cobrar desde el detalle de la orden no se refleja en la mesa porque el carril que usa esa pantalla es justamente el que no proyecta. Marcar `paid_at` ahí sería el quinto dialecto; el arreglo es que los cuatro pasen por una sola función. El corte también quita del webhook un cierre que nadie decidió: cerrar la sesión es un acto del mesero, no un efecto secundario de que un procesador de pagos confirme. Y el carril de split, que hoy marca y emite por su cuenta, deja de poder divergir en la próxima edición.
- **Output:** Los cuatro escritores llaman a la función canónica y ninguno escribe `paid_at` ni emite el evento por su cuenta. El webhook deja de llamar al cierre de sesión: proyecta el pago y deja la mesa ocupada. `payOrder` gana la proyección **post-commit**, envuelta de modo que un fallo de proyección no revierta un cobro ya cometido: se registra y se expone como ERR-33 sin tocar el estado del pago. Los confirmadores de FB-12 y FB-53 quedan auditados y, si escribían la sesión por su cuenta, también cortados. Specs por escritor.
- **Contracts touched:** FB-03 (cobro POS de mesa delega), FB-04 (`flow/pay` proyecta por primera vez), FB-11 y FB-12 (carril de split), FB-53 (quinto escritor potencial), DB-17 (`paid_at` pasa a tener un solo escritor real), DB-18 (`closed_at` deja de escribirse desde el webhook), DB-21 (`tables.status` deja de moverse por un cobro), ERR-05 (deja de alcanzarse por el camino de la mesa ya cobrada desde la orden), ERR-33 (empieza a poder dispararse de verdad).
- **Data impact:** Escribe `table_sessions.paid_at` desde el carril de `flow/pay`, que antes no escribía nada. **Deja de escribir** `table_sessions.closed_at` y `tables.status='cleaning'` desde el webhook de pasarela. Sin DDL, sin script de backfill y sin corrección retroactiva: las sesiones que el webhook cerró de más en el pasado **no se reabren** automáticamente —reabrirlas chocaría con el índice único de una sola sesión abierta por mesa si el mesero ya abrió otra—, se dejan como están y el paso lo registra como deuda conocida.
- **Blast radius:** Alto y bien delimitado. Si la proyección se cuela **dentro** de la transacción del pago en `payOrder` y falla, un cobro válido se revierte: el cajero cobra y el pago desaparece. Si el webhook pierde el cierre sin que la UI de mesa ofrezca cerrar, las mesas pagadas en línea se acumulan ocupadas y lo nota el encargado al cierre del turno. Si un quinto escritor queda sin cortar, la divergencia vuelve por la puerta de atrás y solo se ve en producción. Afecta a los cuatro carriles de cobro a la vez: es el paso con mayor superficie del plan.
- **Rollback:** Por escritor y en cualquier orden: cada corte es una llamada sustituida, así que revertir uno devuelve exactamente su comportamiento anterior sin tocar los otros tres. El único efecto no reversible por código son las filas `paid_at` ya escritas por el carril nuevo, que son correctas bajo ADR-03 y no se borran. Revertir el escritor del webhook devuelve el cierre automático, que es el defecto de origen: ver ADR-03 §Reversibility (`costly`).
- **Verification:**
  - `curl -sk -o ../evidence/B.2-flowpay.json -w '%{http_code}\n' -X POST "https://api.vendix.com/api/store/orders/$TABLE_ORDER/flow/pay" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"payment_method_id":1,"amount":0}'`
  - `psql "$DATABASE_URL" -c "SELECT id, paid_at, closed_at FROM table_sessions WHERE order_id=$TABLE_ORDER;"` (espera `paid_at` no nulo y `closed_at` nulo)
  - `psql "$DATABASE_URL" -c "SELECT t.id, t.status FROM tables t JOIN table_sessions s ON s.table_id=t.id WHERE s.order_id=$TABLE_ORDER;"` (espera `occupied`)
  - `psql "$DATABASE_URL" -c "SELECT count(*) FROM table_sessions WHERE closed_at IS NULL AND paid_at IS NOT NULL;"` (comparar contra `evidence/B.1-baseline.txt`: debe crecer, nunca decrecer)
  - `grep -rn "markSessionPaid\|emitSessionPaid" apps/backend/src | tee ../evidence/B.2-escritores.txt` (espera: solo dentro de la función canónica y sus specs)
  - `grep -n "closeSession" apps/backend/src/domains/store/payments/services/webhook-handler.service.ts` (espera: sin coincidencias)
  - `npm --prefix apps/backend run test:path -- src/domains/store/payments/payments.service.spec.ts`
  - `npm --prefix apps/backend run test:path -- src/domains/store/tables/split-account-payment.service.spec.ts`
  - `npm --prefix apps/backend run test:path -- src/domains/store/orders/order-flow/order-flow.service.spec.ts`
- **Acceptance checklist:**
  - [ ] Los cuatro escritores llaman a la función canónica y ninguno escribe la sesión por su cuenta
  - [ ] Una búsqueda de la primitiva y del emisor no encuentra llamadores fuera de la función canónica
  - [ ] El webhook de pasarela ya no cierra la sesión ni mueve la mesa a limpieza
  - [ ] El webhook sí marca la cuenta como pagada, que antes no hacía
  - [ ] La proyección de `flow/pay` corre después del commit del pago
  - [ ] Un fallo de proyección no revierte ni altera el pago ya cometido
  - [ ] Un fallo de proyección se expone con el código tipado y nunca como 500
  - [ ] Los confirmadores de pago de sesión y de cuenta de split quedan auditados y cortados si escribían la sesión
  - [ ] Cobrar la misma orden dos veces no produce un segundo efecto sobre la sesión
  - [ ] Ninguna fila queda con sesión pagada y mesa liberada por el solo hecho de cobrar
  - [ ] Hay spec por escritor que verifica que delega y no escribe directo
  - [ ] Queda registrado como deuda que las sesiones cerradas de más por el webhook no se reabren
  - [ ] Las filas FB-03, FB-04, FB-11, FB-12, FB-53, DB-17, DB-18, DB-21, ERR-05 y ERR-33 quedan marcadas
- **Status:** in-progress — cuatro escritores y confirmación staff en 5848a2a24, 086ba3133, 497042873. `evidence/B2-split-table-projection-20260923.md`: primera cuenta parcial deja `paid_at=NULL`, última cuenta marca `paid_at`, mesa sigue ocupada hasta cierre; `3e53d4f16` congela líneas de la fuente bajo lock (antes la orden pagada con split seguía `draft`/editable). POS mesa y detalle probados en E2/E4. Faltan webhook de pasarela y confirmadores con evidencia runtime propia, más decisión sobre estado operativo de origen al saldar split. T5 (2026-09-23): crédito corta a canónica (`:4442`, solo al saldar; ERR-33 sin `finished` falso) + `confirmPayment` aísla fallo (SSE/caja intactos, ERR-33 al final); Jest 135/135 + 59/59; `evidence/B2-credit-confirm-projection-20260923.md`.

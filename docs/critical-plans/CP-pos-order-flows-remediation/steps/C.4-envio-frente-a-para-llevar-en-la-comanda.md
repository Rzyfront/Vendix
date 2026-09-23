---
id: C.4
title: "ENVÍO frente a PARA LLEVAR en la comanda del KDS"
phase: C
status: in-progress
owner: Bohr
updated: 2026-09-20
contracts: [FB-36, FB-37, FB-38, FB-16, FB-19, DB-04, DB-10]
adrs: [ADR-01, ADR-06]
skills: [vendix-restaurant-ops, vendix-backend-api, vendix-zoneless-signals, how-to-test]
---
# C.4 — ENVÍO frente a PARA LLEVAR en la comanda del KDS

- **Skills:** `vendix-restaurant-ops` (KDS, `KITCHEN_TICKET_INCLUDE`, los 6 caminos de lectura del ticket) · `vendix-backend-api` (forma de respuesta compartida por snapshot, stream y listado) · `vendix-zoneless-signals` (computados del ticket: `allTakeaway`, badge, sin `markForCheck`) · `how-to-test` (curl del SSE y del snapshot, recorrido de cocina).
- **Resources:** ADR-01 («el KDS puede distinguir ENVÍO de PARA LLEVAR leyendo `delivery_type`, que es lo que hace posible la fase C sin tocar `is_takeaway`») · ADR-06 · `apps/backend/.../kitchen-fire/kitchen-fire.service.ts:21-34` (`KITCHEN_TICKET_INCLUDE`, `order.select` sin `delivery_type`) · `:2656-2668` (la compuerta que sí lee el booleano) · `apps/frontend/.../kds/interfaces/kitchen-ticket.interface.ts:57-64` (`order_item?: { is_takeaway: boolean }`) y `:157-170` (`KitchenTicket.order`) · `apps/frontend/.../kds/components/kds-ticket-card/kds-ticket-card.component.html:84-88` (badge) y `.component.ts:48-57` (`allTakeaway`) · `apps/frontend/.../kds/components/kds-ticket-detail-modal/kds-ticket-detail-modal.component.ts:73` · ficha F-030 de la auditoría de origen.
- **Business decision:** ADR-01 fija que «para llevar» es `direct_delivery`. Este paso aplica esa decisión **solo a la etiqueta**: el badge del KDS se pinta leyendo `orders.delivery_type` y distingue ENVÍO (`home_delivery`) de PARA LLEVAR (`direct_delivery`). `is_takeaway` **no se toca** — ni su valor, ni su escritura, ni ninguna de las reglas que gobierna: compuerta takeaway-only, atajo `in_preparation`, identidad de línea del carrito y split de preparación. Separar etiqueta de regla es la condición que permite entregar esta fase sin arriesgar el diseño takeaway-only.
- **Why:** la cocina empaca igual dos cosas que se empacan distinto. El ticket solo transporta `order_item.is_takeaway`, y dos intenciones diferentes escriben ese mismo booleano: el envío del POS lo fuerza en literal y el domicilio del ecommerce también. El badge, en consecuencia, dice «Para llevar» tanto para un domicilio como para un retiro en el acto. El dato que los distingue ya existe en `orders.delivery_type` con cinco valores; solo falta transportarlo. Es barato porque los cuatro caminos de lectura del ticket comparten un único `include`: añadir `delivery_type: true` al `order.select` lo hace viajar gratis por el snapshot, por el listado y por los seis eventos SSE. **Precondición:** el paso depende de que `delivery_type` se persista de verdad (DB-04 y FB-16: hoy `orders.create` lo descarta y toda orden API nace con el default del esquema) y de que el editor deje de estampar `pickup` (FB-19). Si C.4 se despliega antes que esos pasos, el badge leería un dato que nadie grabó.
- **Output:** `delivery_type: true` añadido al `order.select` de `KITCHEN_TICKET_INCLUDE`; el tipo `KitchenTicket.order` del frontend declara el campo con los cinco valores; el badge del ticket y el del modal de detalle pasan a derivar su **etiqueta** de `delivery_type` con tres rótulos (ENVÍO, PARA LLEVAR, y nada para consumo en mesa), conservando el `@if` propio fuera de la cadena de estado; `allTakeaway` y el resto de computados siguen leyendo `is_takeaway` sin cambio.
- **Contracts touched:** FB-36 (stream SSE), FB-37 (snapshot), FB-38 (listado de tickets) — los tres por compartir el include; FB-16 y FB-19 como precondición de que el dato exista; DB-04 (persistencia de `delivery_type`), DB-10 (`is_takeaway` invariante: mismo conteo agrupado antes y después).
- **Data impact:** none — el paso solo añade una columna al `select` de lectura y cadenas de UI. Ninguna escritura, ninguna migración: `orders.delivery_type` ya existe con sus cinco valores.
- **Blast radius:** tablero KDS y modal de detalle del ticket, en las cuatro rutas de lectura. Si el badge se ata al dato equivocado, la cocina empaca un domicilio como consumo en mesa y el pedido sale sin caja; si se toca `is_takeaway` por error, se rompen a la vez la compuerta takeaway-only, el atajo `in_preparation` y la identidad de línea del carrito. Quien lo nota: el cocinero y el domiciliario. Señal: pedidos de domicilio sin empaque, o el botón «Entregar» del KDS habilitándose donde antes no lo hacía.
- **Rollback:** trivial. Quitar `delivery_type` del include y devolver el badge a su lectura anterior; no hay dato escrito que revertir y ningún consumidor pierde información que antes tuviera.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.spec.ts` — el include ampliado no rompe ninguna forma existente.
  - `curl -s "$API/store/kitchen-fire/snapshot?windowMinutes=120" -H "Authorization: Bearer $TOKEN_COCINA" | jq '.data[0].order' | tee evidence/C.4-snapshot-order.json` → incluye `delivery_type`.
  - `curl -sN "$API/store/kitchen-fire/stream" -H "Authorization: Bearer $TOKEN_COCINA" | head -c 4000 > evidence/C.4-sse-frames.txt` — el primer `snapshot` y el primer `ticket.*` traen `delivery_type`.
  - `curl -s "$API/store/kitchen-fire/tickets?order_id=$OID" -H "Authorization: Bearer $TOKEN_COCINA" | jq '.data[0].order' >> evidence/C.4-snapshot-order.json`
  - `psql "$DB" -c "SELECT is_takeaway, count(*) FROM order_items GROUP BY 1 ORDER BY 1" > evidence/C.4-is-takeaway-antes-despues.txt` — idéntico antes y después.
  - `grep -rn "is_takeaway" apps/frontend/src/app/private/modules/store/restaurant-ops/kds/ > evidence/C.4-censo-is-takeaway.txt` — los usos de REGLA siguen; solo cambia el del badge.
  - Playwright MCP: disparar a cocina una orden `home_delivery` y una `direct_delivery` y capturar los dos rótulos distintos en `evidence/C.4-badges/`.
- **Acceptance checklist:**
  - [ ] El `order.select` del include de ticket incluye `delivery_type`, y snapshot, stream y listado lo devuelven los tres.
  - [ ] El tipo del frontend declara `delivery_type` en `KitchenTicket.order` con los valores reales del enum.
  - [ ] Una orden `home_delivery` muestra ENVÍO en el tablero; una `direct_delivery` muestra PARA LLEVAR.
  - [ ] Una orden `dine_in` no muestra ninguno de los dos rótulos de empaque.
  - [ ] Al recargar el tablero el rótulo se conserva: viene del snapshot, no solo del SSE.
  - [ ] `is_takeaway` conserva valor y reglas: conteo agrupado idéntico y compuerta takeaway-only sin cambio de comportamiento.
  - [ ] El botón «Entregar» del KDS sigue habilitándose exactamente con el mismo criterio que antes del paso.
  - [ ] El paso se despliega después de que `delivery_type` se persista de verdad; si no, el badge queda leyendo el default del esquema.
- **Status:** in-progress — contrato/badges en 37005e554; 30 tests y watch OK. `evidence/C4-kds-readonly-20260923.md`: lista histórica trae `delivery_type` y `is_takeaway` coherentes en home/direct/dine-in, pero snapshot/SSE del día y UI están vacíos. Faltan tickets actuales seguros para los tres badges; no se abrió Cocina #1 por backfill de inventario.

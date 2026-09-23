---
id: I.4
title: "Acotar la arista `delivered→processing`"
phase: I
status: in-progress
owner: none
updated: 2026-09-20
contracts: [FB-17, DB-01, DB-08, DB-23]
adrs: [ADR-09]
skills: [vendix-backend, vendix-restaurant-ops, vendix-error-handling, how-to-test]
---
# I.4 — Acotar la arista `delivered→processing`

- **Skills:** `vendix-backend` (la máquina de estados y el forzado viven en el servicio de flujo de orden) · `vendix-restaurant-ops` (el único llamador legítimo es el puente de reversa del KDS, «un paso atrás» sobre un ticket terminal) · `vendix-error-handling` (el rechazo del carril genérico es tipado, y el forzado legítimo queda auditado con motivo) · `how-to-test` (reversa desde el KDS, PATCH genérico, y transición masiva como control).
- **Resources:** `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:60-72` (`VALID_TRANSITIONS`, con el comentario que declara la arista como reversa del ticket de cocina) · `:4170-4200` (`forceOrderState`, que calcula `forced` por pertenencia a `VALID_TRANSITIONS` y por tanto audita esta transición como legítima) · `revertKitchenOrderDelivery` (el puente que sí debe poder recorrerla) · `apps/backend/src/domains/store/orders/dto/bulk-orders.dto.ts:73-78` (`BULK_ORDER_TRANSITION_TARGETS`, donde el carril masivo ya quedó cerrado) · ficha de origen `F-016` (parcialmente cerrada por `dfdd47a2d`) · ADR-09 declara la arista propiedad del puente KDS.
- **Business decision:** la arista queda **reservada al puente del KDS**. Cualquier otro llamador que quiera devolver una orden entregada a preparación pasa por el forzado explícito, con motivo obligatorio, y queda auditado como forzado — no como transición legal. La arista no se elimina de la máquina de estados a ciegas: se le pone dueño, porque el puente de cocina depende de ella.
- **Why:** el carril masivo sí se cerró, pero el unitario sigue abierto: un `PATCH /store/orders/:id {"state":"processing"}` sobre una orden entregada entra por el update genérico, llega a `forceOrderState`, y como la arista está en `VALID_TRANSITIONS` se registra con `forced: false`. Es decir: queda **auditada como reversa legítima**, indistinguible de la del KDS para quien lea la auditoría después. El daño no es el cambio de estado, que a veces es correcto: es que la auditoría deja de poder responder quién lo hizo y por qué, justo en la transición que deshace una entrega.
- **Output:** guard por llamador en el camino de la arista, de modo que solo el puente de reversa de cocina la recorra como transición legal; el resto queda obligado a forzado con motivo, con `forced: true` y el motivo en `internal_notes._flow_metadata.forced_transition`; y una nota en el comentario de `VALID_TRANSITIONS` que nombre al dueño de la arista, para que el próximo lector no la crea de uso general.
- **Contracts touched:** FB-17, DB-01, DB-08, DB-23
- **Data impact:** escribe `orders.state` y `internal_notes._flow_metadata` en las transiciones nuevas. Ninguna fila histórica se reescribe y ninguna auditoría pasada se corrige: las reversas ya registradas como legítimas quedan como están, y la consulta de verificación sirve para contarlas, no para arreglarlas. Sin migración.
- **Blast radius:** el tablero de cocina (que debe seguir pudiendo dar un paso atrás sobre un ticket terminal), el detalle de orden, y la auditoría de órdenes. Si el guard se cierra de más, el KDS deja de poder revertir una entrega y el cocinero queda sin salida: lo nota en el acto. Si se cierra de menos, sigue habiendo reversas de entrega sin autor ni motivo: lo nota quien audite, cuando ya no se puede reconstruir. `order_items.delivered_at` y el estado de los ítems del ticket no se tocan en este paso.
- **Rollback:** revertir el commit devuelve la arista a uso general. Sin dato que deshacer; las transiciones ya auditadas como forzadas siguen siendo legibles y más informativas que las anteriores.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` — reversa desde el puente de cocina (legal), `PATCH` genérico (forzado con motivo), y forzado sin motivo (rechazo)
  - `curl -s -o evidence/I4-patch-generico.json -w '%{http_code}' -X PATCH "$API/store/orders/$ORDER_ID" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"state":"processing"}'` sobre una orden entregada
  - `curl -s "$API/store/kitchen-fire/tickets/$TICKET_ID/revert" …` desde el KDS sobre un ticket terminal → la orden retrocede y la auditoría la marca como legal, evidencia en `evidence/I4-revert-kds.json`
  - SQL de solo lectura: `SELECT id, internal_notes FROM orders WHERE internal_notes::text LIKE '%"from":"delivered","to":"processing"%' AND updated_at > :deploy;` y comprobar que toda fila nueva lleva `forced` y motivo → `evidence/I4-auditoria-arista.txt`
  - SQL de solo lectura de control: `SELECT k.id FROM kitchen_ticket_items k JOIN order_items i ON i.id = k.order_item_id WHERE i.delivered_at IS NOT NULL AND k.status <> 'delivered';` = 0 filas → `evidence/I4-sincronia-cocina.txt`
- **Acceptance checklist:**
  - [ ] El puente de reversa del KDS sigue pudiendo devolver una orden entregada a preparación, sin fricción nueva
  - [x] El PATCH genérico que recorre la arista queda auditado como forzado, con motivo obligatorio y usuario
  - [x] Un forzado sin motivo se rechaza con código tipado
  - [ ] El carril de transición masiva conserva su cierre actual y no recupera el destino de preparación
  - [ ] La sincronía entre entrega de ítem y estado del ítem de ticket no cambia en ningún caso
  - [x] El comentario de la máquina de estados nombra al dueño de la arista
  - [ ] Ninguna auditoría histórica se reescribe; la consulta solo cuenta las que ya existen
- **Status:** in-progress — código provisional `eea29dbdf`. API local orden QA #1123: PATCH sin motivo 400 `ORD_DELIVERED_REVERSAL_REASON_REQUIRED_001` y estado intacto; con motivo 200, `processing` y `forced_transition.forced=true` con usuario 162 y motivo (`evidence/I4-*`). Falta KDS runtime, regresión total de spec y aceptación de ADR-09.

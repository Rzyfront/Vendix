---
id: C.2
title: "Reconciliar los escritores huérfanos de delivered_at"
phase: C
status: in-progress
owner: none
updated: 2026-09-20
contracts: [FB-33, FB-34, DB-08, DB-23]
adrs: [ADR-06]
skills: [vendix-restaurant-ops, vendix-backend-domain, how-to-test]
---
# C.2 — Reconciliar los escritores huérfanos de `delivered_at`

- **Skills:** `vendix-restaurant-ops` (ticket de cocina, sincronía cocina↔orden) · `vendix-backend-domain` (listeners post-commit, contexto de tienda) · `how-to-test` (curl + SQL de invariante). Para la costura de entrega en sí no hay skill: `[Sin skill — knowledge gap]` — haría falta `vendix-order-delivery-seam`, que fije quién puede estampar y quién puede borrar `order_items.delivered_at` y en qué dirección sincroniza cada carril.
- **Resources:** ADR-06 · `order-flow.service.ts` (`deliverOrderItem`, `syncKitchenOnOrderItemDelivered`, `reconcileKitchenAfterDispatch`) · `kitchen-fire.service.ts` (`markDelivered`, `revertTicket`, `emitTicketUpdatedEvent`) · `dispatch-note-events.listener.ts` (`stampOrderItemsDeliveredFromDispatch`, proyección KDS post-commit) · `evidence/C2-dispatch-kds-projection-20260923.md` · `evidence/C2-ticket-updated-sse-20260923.md`.
- **Business decision:** ADR-06 invierte la dirección de sincronía: **la orden manda y la cocina refleja**, porque la orden es lo que se cobra. En consecuencia, `order_items.delivered_at` tiene un solo estampador legítimo por carril y todo camino que lo escriba o lo invalide debe dejar `kitchen_ticket_items` coherente en el mismo acto. Este paso **no** borra ningún carril: reconcilia los tres que hoy escriben fuera del seam. El despacho conserva su excepción declarada (la mercancía ya salió, no se le exige `ready`); se documenta como excepción, no se convierte en regla.
- **Why:** hay tres escritores de `order_items.delivered_at` y dos rompen la invariante. (1) `kitchen-fire.markDelivered` estampa **todos** los `order_items` del ticket (`:2710-2726`) — tras C.1 deja de recibir tráfico de mesa, pero el KDS lo sigue invocando y el daño de ticket mixto persiste ahí. (2) `revertTicket` (`:2981`) devuelve el ticket y sus `kitchen_ticket_items` a `ready`, pero **nunca limpia `delivered_at`**: la línea de pedido queda sellada como entregada sobre un ticket que ya no lo está, y DB-23 (`delivered_at NOT NULL ⇒ ticket item en delivered`) queda violada en silencio; la orden vuelve a `processing` por el evento `kitchen.order_delivery_reverted` mientras sus líneas siguen diciendo «servido». (3) El listener de despacho estampa por coincidencia producto↔línea sin pasar por el seam ni tocar cocina: sobre una orden de restaurante con remisión, una línea puede quedar entregada sin que su ticket lo sepa.
- **Output:** `revertTicket` limpia `delivered_at`/`delivered_by_user_id` dentro de su transacción; `markDelivered` documenta alcance ticket-completo; despacho estampa el hecho físico sin exigir `ready` y proyecta luego a la fila KDS vigente, con tenant restaurado, sin puente de estado KDS→orden. El replay reconcilia un sello anterior sin mover su timestamp. Las líneas sin ticket se auditan. Specs cubren los tres carriles.
- **Contracts touched:** FB-34 (revert deja de dejar la línea sellada), FB-33 (alcance ticket-completo declarado), DB-08 (`delivered_at` con escritores acotados y monótono salvo la reversa explícita), DB-23 (la implicación ticket↔línea vuelve a sostenerse).
- **Data impact:** Revert limpia la marca de entrega de sus líneas. Despacho ahora marca `kitchen_ticket_items.status=delivered` y cierra el `kitchen_ticket` cuando todas sus líneas son terminales; antes dejaba ambos pendientes aunque el cliente ya recibió la orden. Sin migración ni backfill histórico; una falla post-commit se observa y un replay la repara.
- **Blast radius:** KDS (cocinero que revierte un ticket), detalle de orden y mesa (la línea deja de mostrarse entregada), y el puente `delivered→processing`. Si la limpieza se pasa de alcance, se pierde la marca de entrega de líneas servidas de otro ticket y el mesero las vuelve a servir. Quien lo nota primero: el mesero, al ver un plato ya servido como pendiente. Señal: filas con `delivered_at IS NULL` cuyo ticket sigue en `delivered`.
- **Rollback:** revertir código restaura los defectos; las marcas limpiadas por revert no recuperan su timestamp sin auditoría y los tickets ya proyectados por despacho permanecen entregados (coherentes con la orden). Nuevos despachos volverían a dejar KDS pendiente; comparar el SQL post-corte antes de revertir.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.spec.ts` — el revert limpia la marca y sigue emitiendo el puente de reversa.
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` — `deliverOrderItem` sigue siendo idempotente tras un revert.
  - `curl -s -X POST "$API/store/kitchen-fire/tickets/$TID/delivered" -H "Authorization: Bearer $TOKEN_COCINA" -o evidence/C.2-ticket-delivered.json -w '%{http_code}\n'`
  - `curl -s -X POST "$API/store/kitchen-fire/tickets/$TID/revert" -H "Authorization: Bearer $TOKEN_COCINA" -o evidence/C.2-ticket-revert.json -w '%{http_code}\n'`
  - Ejecutar `evidence/C2-latest-ticket-audit-20260923.sql`: comparar solo la última fila `kitchen_ticket_items` por `order_item_id` (`id DESC`). Anotar legado y exigir 0 descuadres del corte en adelante; la consulta contra TODAS las filas produce falsos positivos con re-fire.
  - `psql "$DB" -c "SELECT count(*) FROM order_items WHERE delivered_at > updated_at AND delivered_at >= '2026-09-23'"` → 0 nuevos; 18 legados quedan inventariados.
  - `evidence/C2-dispatch-kds-projection-20260923.md`: POS preparado a domicilio → fire pendiente → pago → remisión entregada; ítem y última fila/ticket KDS quedan entregados, 0 inventario; replay conserva timestamp.
  - `evidence/C2-ticket-updated-sse-20260923.md`: mesa con ticket mixto #112 → entrega parcial emite 1× `ticket.updated` (ticket `ready`, líneas delivered/ready), entrega final emite 1× `ticket.updated` (ticket + líneas `delivered`); replay no duplica; `KdsSseService` reconcilia por upsert de id.
  - `grep -rn "delivered_at:" apps/backend/src --include='*.ts' | grep -v '\.spec\.' | grep -v ': true' > evidence/C.2-censo-escritores.txt` — el censo cabe en los tres carriles documentados.
- **Acceptance checklist:**
  - [x] Revertir un ticket entregado deja sus `order_items.delivered_at` en NULL dentro de la misma transacción que revierte el ticket.
  - [ ] Tras revertir, la consulta del ticket VIGENTE↔línea no añade ninguna fila nueva (legado #1692 separado, sin backfill).
  - [x] La limpieza del revert alcanza solo las líneas de ESE ticket: las de otro ticket de la misma orden conservan su marca.
  - [x] `kitchen-fire.markDelivered` documenta en su docblock que su alcance es el ticket completo y cuál es el carril por ítem.
  - [x] El listener de despacho documenta su excepción y registra en log las líneas que selló sin ticket asociado.
  - [x] Despacho preparado con ticket `pending` proyecta a KDS `delivered` sin esperar `ready` ni emitir puente KDS→orden; replay puede reparar proyección omitida.
  - [x] Entrega por ítem (mesa/orden) emite `ticket.updated` con el ticket completo en vivo, parcial y final, sin falsear `ticket.delivered`; replay no re-emite; frontend reconcilia por upsert.
  - [ ] El censo de escritores de `delivered_at` no crece: sigue siendo seam de orden, cocina y despacho.
  - [ ] Conteo previo de descuadres históricos guardado como línea base en `evidence/C2-*`; entrega al dueño pendiente.
  - [ ] F-002 — AUDIT F-032 - revertTicket nunca limpia delivered_at (major)
- **Status:** in-progress — revert y censo previo `1537df4ef`/`79a426485`; proyección despacho `evidence/C2-dispatch-kds-projection-20260923.md`: red #1186 dejó KDS pendiente, green #1187 entregó ítem/ticket, 0 descuadres postcut tras reconciliar fixture pre-fix; SSE `evidence/C2-ticket-updated-sse-20260923.md`: #112 parcial 1×updated + final 1×updated, replay sin duplicado. Jest focalizado 191/191, watch/health OK, cp-lint 0. Legado real #1692 y 18 marcas antiguas DB-08 sin backfill. Faltan revert curl+SQL y aceptación ADR-06.

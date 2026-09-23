---
id: C.2
title: "Reconciliar los escritores huérfanos de delivered_at"
phase: C
status: pending
owner: none
updated: 2026-09-20
contracts: [FB-33, FB-34, DB-08, DB-23]
adrs: [ADR-06]
skills: [vendix-restaurant-ops, vendix-backend-domain, how-to-test]
---
# C.2 — Reconciliar los escritores huérfanos de `delivered_at`

- **Skills:** `vendix-restaurant-ops` (ticket de cocina, sincronía cocina↔orden) · `vendix-backend-domain` (listeners post-commit, contexto de tienda) · `how-to-test` (curl + SQL de invariante). Para la costura de entrega en sí no hay skill: `[Sin skill — knowledge gap]` — haría falta `vendix-order-delivery-seam`, que fije quién puede estampar y quién puede borrar `order_items.delivered_at` y en qué dirección sincroniza cada carril.
- **Resources:** ADR-06 (consecuencia final: «quedan por reconciliar los caminos huérfanos») · `apps/backend/.../order-flow/order-flow.service.ts:1808-1887` (seam canónico) y `:1904-1960` (`syncKitchenOnOrderItemDelivered`) · `apps/backend/.../kitchen-fire/kitchen-fire.service.ts:2695-2726` (`markDelivered`: ticket entero + `order_items.updateMany`) y `:2981-3055` (`revertTicket`: revierte ticket e ítems de ticket y **no** toca `delivered_at`) · `apps/backend/.../dispatch-notes/listeners/dispatch-note-events.listener.ts:435-515` (`stampOrderItemsDeliveredFromDispatch`) · `apps/backend/.../orders/order-flow/listeners/kitchen-order-delivery-reverted.listener.ts`.
- **Business decision:** ADR-06 invierte la dirección de sincronía: **la orden manda y la cocina refleja**, porque la orden es lo que se cobra. En consecuencia, `order_items.delivered_at` tiene un solo estampador legítimo por carril y todo camino que lo escriba o lo invalide debe dejar `kitchen_ticket_items` coherente en el mismo acto. Este paso **no** borra ningún carril: reconcilia los tres que hoy escriben fuera del seam. El despacho conserva su excepción declarada (la mercancía ya salió, no se le exige `ready`); se documenta como excepción, no se convierte en regla.
- **Why:** hay tres escritores de `order_items.delivered_at` y dos rompen la invariante. (1) `kitchen-fire.markDelivered` estampa **todos** los `order_items` del ticket (`:2710-2726`) — tras C.1 deja de recibir tráfico de mesa, pero el KDS lo sigue invocando y el daño de ticket mixto persiste ahí. (2) `revertTicket` (`:2981`) devuelve el ticket y sus `kitchen_ticket_items` a `ready`, pero **nunca limpia `delivered_at`**: la línea de pedido queda sellada como entregada sobre un ticket que ya no lo está, y DB-23 (`delivered_at NOT NULL ⇒ ticket item en delivered`) queda violada en silencio; la orden vuelve a `processing` por el evento `kitchen.order_delivery_reverted` mientras sus líneas siguen diciendo «servido». (3) El listener de despacho estampa por coincidencia producto↔línea sin pasar por el seam ni tocar cocina: sobre una orden de restaurante con remisión, una línea puede quedar entregada sin que su ticket lo sepa.
- **Output:** `revertTicket` limpia `delivered_at`/`delivered_by_user_id` de las líneas del ticket revertido dentro de su misma transacción, con la misma condición de alcance que usa para los `kitchen_ticket_items`; `kitchen-fire.markDelivered` deja constancia explícita en su docblock de que su alcance es ticket-completo y de que el carril por ítem es `deliverOrderItem`; el listener de despacho documenta su excepción y registra en log qué líneas selló sin ticket. Se añade una prueba de invariante que recorre los tres caminos.
- **Contracts touched:** FB-34 (revert deja de dejar la línea sellada), FB-33 (alcance ticket-completo declarado), DB-08 (`delivered_at` con escritores acotados y monótono salvo la reversa explícita), DB-23 (la implicación ticket↔línea vuelve a sostenerse).
- **Data impact:** `revertTicket` pasa a poner `delivered_at = NULL` y `delivered_by_user_id = NULL` en las líneas de ese ticket — es la **única** escritura nueva del paso y es la que restituye la invariante. Sin migraciones. No hay backfill: las filas históricas descuadradas se cuentan con el SQL de verificación y se entregan al dueño como inventario, según el `Non-Goal` de reparación de datos del hub.
- **Blast radius:** KDS (cocinero que revierte un ticket), detalle de orden y mesa (la línea deja de mostrarse entregada), y el puente `delivered→processing`. Si la limpieza se pasa de alcance, se pierde la marca de entrega de líneas servidas de otro ticket y el mesero las vuelve a servir. Quien lo nota primero: el mesero, al ver un plato ya servido como pendiente. Señal: filas con `delivered_at IS NULL` cuyo ticket sigue en `delivered`.
- **Rollback:** reversible en código (quitar la limpieza y el docblock), pero el dato **no** vuelve solo: una línea cuya marca se borró no recupera el `delivered_at` original salvo por el `audit_logs` y el log del ticket. Antes de desplegar se ejecuta el conteo de descuadres y se guarda como línea base en `evidence/`.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.spec.ts` — el revert limpia la marca y sigue emitiendo el puente de reversa.
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` — `deliverOrderItem` sigue siendo idempotente tras un revert.
  - `curl -s -X POST "$API/store/kitchen-fire/tickets/$TID/delivered" -H "Authorization: Bearer $TOKEN_COCINA" -o evidence/C.2-ticket-delivered.json -w '%{http_code}\n'`
  - `curl -s -X POST "$API/store/kitchen-fire/tickets/$TID/revert" -H "Authorization: Bearer $TOKEN_COCINA" -o evidence/C.2-ticket-revert.json -w '%{http_code}\n'`
  - `psql "$DB" -c "SELECT k.id FROM kitchen_ticket_items k JOIN order_items i ON i.id=k.order_item_id WHERE i.delivered_at IS NOT NULL AND k.status<>'delivered'" > evidence/C.2-invariante-db23.txt` → 0 filas.
  - `psql "$DB" -c "SELECT count(*) FROM order_items WHERE delivered_at > updated_at" > evidence/C.2-invariante-db08.txt` → 0.
  - `grep -rn "delivered_at:" apps/backend/src --include='*.ts' | grep -v '\.spec\.' | grep -v ': true' > evidence/C.2-censo-escritores.txt` — el censo cabe en los tres carriles documentados.
- **Acceptance checklist:**
  - [ ] Revertir un ticket entregado deja sus `order_items.delivered_at` en NULL dentro de la misma transacción que revierte el ticket.
  - [ ] Tras revertir, la consulta de invariante ticket↔línea devuelve 0 filas.
  - [ ] La limpieza del revert alcanza solo las líneas de ESE ticket: las de otro ticket de la misma orden conservan su marca.
  - [ ] `kitchen-fire.markDelivered` documenta en su docblock que su alcance es el ticket completo y cuál es el carril por ítem.
  - [ ] El listener de despacho documenta su excepción y registra en log las líneas que selló sin ticket asociado.
  - [ ] El censo de escritores de `delivered_at` no crece: sigue siendo seam de orden, cocina y despacho.
  - [ ] Conteo previo de descuadres históricos guardado como línea base en `evidence/C.2-*` y entregado al dueño.
  - [ ] F-002 — AUDIT F-032 - revertTicket nunca limpia delivered_at (major)
- **Status:** pending

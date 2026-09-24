---
id: C.1
title: "Enrutar toda entrega desde la mesa por el seam de orden"
phase: C
status: done
owner: toss
updated: 2026-09-24
contracts: [FB-31, FB-32, FB-33, DB-08, DB-23, DB-24, ERR-07, ERR-08, ERR-12]
adrs: [ADR-06]
skills: [vendix-restaurant-ops, vendix-zoneless-signals, how-to-test]
---
# C.1 — Enrutar toda entrega desde la mesa por el seam de orden

- **Skills:** `vendix-restaurant-ops` (mesa, KDS, ticket de cocina) · `vendix-zoneless-signals` (señales `deliveringTicketId` / `deliveringItemId`, sin `markForCheck`) · `how-to-test` (recorrido Playwright MCP con dos roles y curl del contrato).
- **Resources:** ADR-06 · `apps/frontend/.../table-session-page/table-session-page.component.ts:1246-1332` (`markDelivered`, condición `:1252`, `deliverTableSessionItem:1309`) · `:820` (`needsKitchen`) · `:874` (`ticketIdFor`) · `apps/frontend/.../tables/services/tables.service.ts:298` (`markItemDelivered`) · `apps/backend/.../tables/table-sessions.service.ts:2100-2131` (shim que delega) · `apps/backend/.../order-flow/order-flow.service.ts:1808-1887` (`deliverOrderItem`) · `apps/backend/.../kitchen-fire/kitchen-fire.service.ts:2607-2730` (`markDelivered`: lock `:2611`, takeaway-only `:2656`, `updateMany` de ticket entero `:2695-2720`) · fichas N8 del reporte del dueño (2026-09-20).
- **Business decision:** ADR-06: **toda** entrega disparada desde la página de mesa pasa por `deliverOrderItem`. Se borra la rama `item.is_takeaway === true && needsKitchen(item)` como desvío al carril de cocina; no se relaja la compuerta takeaway-only ni se le dan permisos de KDS al mesero. El endpoint de cocina sigue existiendo intacto para el tablero. **Es un cambio de condición, no un cableado nuevo:** la rama destino, su spinner (`deliveringItemId`) y su toast ya están escritos y en uso para el caso general.
- **Why:** hoy el «a veces no puedo entregar» tiene tres causas concretas, todas en la misma rama desviada. (1) `assertCanMutateStationTicket` (`kitchen-fire.service.ts:2611`) devuelve 403 `KDS_STATION_LOCKED` si el cocinero tiene turno con heartbeat fresco: el mesero depende del turno ajeno. (2) La compuerta takeaway-only (`:2656-2668`) devuelve 422 sobre cualquier ticket que no sea 100 % de llevar, y un ticket mixto lo es. (3) El `updateMany` final (`:2695-2720`) marca el ticket **completo** y estampa `delivered_at` en todos sus `order_items`: un clic entrega platos que nunca salieron. El seam de orden no tiene ninguno de los tres: opera por ítem, no lee `kds_sessions` y sincroniza `kitchen_ticket_items` en la dirección correcta (`order-flow.service.ts:1904`).
- **Output:** la condición de `markDelivered` queda reducida a una llamada única a `deliverTableSessionItem(item)`; el bloque del carril de cocina, su spinner de ticket y su rama de éxito salen del método (el resto del componente, incluido `onKitchenMutationError`, no se toca). Se documenta en el docblock por qué el destino es único y qué queda para el KDS.
- **Contracts touched:** FB-31 (destino único), FB-32 (seam de mesa que delega), FB-33 (deja de ser destino del mesero), DB-08 (`delivered_at` monótono, un solo escritor desde mesa), DB-23 (`kitchen_ticket_items` refleja), DB-24 (el seam de orden no lee `kds_sessions`), ERR-07 y ERR-08 (dejan de alcanzarse desde mesa), ERR-12 (único rechazo de entrega que queda).
- **Data impact:** escribe `order_items.delivered_at` + `delivered_by_user_id` de **una** fila por clic, y `kitchen_ticket_items.status → delivered` de la fila correspondiente. Ninguna migración. Deja de escribir masivamente el ticket entero, que es exactamente el daño que se corta.
- **Blast radius:** página de mesa (mesero) y tablero KDS (cocinero). Si el enrutado falla, el mesero no entrega ningún plato preparado de llevar y lo nota en el acto; si el seam de orden rechaza de más, aparece `ORDER_ITEM_NOT_DELIVERABLE` sobre platos que cocina sí marcó listos. Señal de detección: tickets en `ready` perpetuo, o al revés, `delivered_at` masivo con el mismo timestamp (que es el síntoma de HOY y debe desaparecer).
- **Rollback:** trivial. Restaurar la condición eliminada en el componente; el endpoint de cocina y su contrato nunca cambian, así que no hay nada que revertir en backend. Las entregas ya selladas quedan y son correctas (una fila por plato servido).
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/tables/table-sessions.service.spec.ts` — el shim sigue delegando en `deliverOrderItem`.
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` — compuerta `prepared`/`ready` e idempotencia intactas.
  - `grep -n "kitchenService.markDelivered" apps/frontend/src/app/private/modules/store/restaurant-ops/tables/pages/table-session-page/table-session-page.component.ts` → 0 hits; en el KDS sigue habiendo hits.
  - `curl -s -X POST "$API/store/kds-sessions/open" -H "Authorization: Bearer $TOKEN_COCINA" -d '{"kds_id":1}' | tee evidence/C.1-kds-open.json` — deja turno ajeno vivo.
  - `curl -s -X PATCH "$API/store/table-sessions/$SID/items/$IID/deliver" -H "Authorization: Bearer $TOKEN_MESERO" -o evidence/C.1-deliver-con-turno-ajeno.json -w '%{http_code}\n'` → 200, no 403.
  - `psql "$DB" -c "SELECT id, delivered_at FROM order_items WHERE order_id=$OID ORDER BY id" > evidence/C.1-delivered-una-sola-fila.txt` — exactamente una fila nueva con `delivered_at`.
  - Playwright MCP: abrir mesa con ticket **mixto** (un plato de llevar + uno de mesa), cocina abre turno, mesero entrega solo el de llevar; capturas a `evidence/C.1-flujo-mesero/`.
- **Acceptance checklist:**
  - [x] `markDelivered` del componente de mesa tiene un solo destino: `deliverTableSessionItem`; cero llamadas a `kitchenService.markDelivered`.
  - [x] El mesero entrega un plato preparado de llevar con el cocinero con turno abierto (heartbeat < 5 min) y recibe 200.
  - [x] Sobre un ticket mixto, entregar una línea marca esa línea y **ninguna otra**: conteo de `delivered_at` no nulos sube en 1.
  - [x] Un plato `prepared` que cocina no marcó `ready` sigue rechazando con `ORDER_ITEM_NOT_DELIVERABLE` (no con el código de cocina).
  - [x] El tablero KDS conserva su botón «Entregar» y su comportamiento takeaway-only sin cambios de contrato.
  - [x] `is_takeaway` de ambas líneas permanece true/false tras la entrega; no se reinterpreta por el endpoint (el conteo global aumenta por la creación de dos líneas QA, no por mutación).
  - [x] Evidencia de los dos roles y del conteo SQL guardada en `evidence/C1-mixed-ticket-other-cook-20260923.md`.
- **Status:** done — toss 2026-09-23. ADR-06 accepted. Barrido global: DB-08 18 legacy + 0 postcut (`C.1-db08-global.txt`, `C.1-db08-legacy-list.txt`); DB-23 1 legado #1692 + postcut 0 (`C.1-db23-sweep.txt`). Código: 0 hits mesa / KDS conserva; shim 77/77; order-flow 146/148 con 2 rojos preexistentes en base (cancelDelivered restock/waste, área D.2, asumidos en D.2). Cierre en `C.1-closeout-20260923.md`. ERR-07/ERR-12 quedan para C.3 (toasts).

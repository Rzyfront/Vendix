---
id: B.1
title: "aceptar order created en SSE"
phase: B
status: done
owner: Rafael Eduardo Martinez Frontado
updated: 2026-09-10
contracts: [FB-01]
adrs: [ADR-01]
skills: [vendix-frontend, vendix-zoneless-signals, vendix-ai-streaming, how-to-dev]
---
# B.1 — aceptar order created en SSE

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-ai-streaming, how-to-dev
- **Resources:** orders-list-sse.service.ts, order-detail-sse.service.ts (patron), orders-list-sse.service.spec.ts
- **Business decision:** Aceptar order.created junto a status_changed; cualquier otro type se sigue ignorando en silencio.
- **Why:** Hoy handleMessage:203 descarta created explicito; sin este cambio el backend emite y la lista no reacciona.
- **Output:** OrdersListSseService con lastCreatedEvent validado + spec actualizado + backoff y close intactos.
- **Contracts touched:** FB-01
- **Data impact:** none — el servicio no muta estado; solo expone signals que el componente consume.
- **Blast radius:** Detalle de orden: si se toca el subject compartido se rompe su filtro por order_id.
- **Rollback:** Revert de 1 archivo + spec; la lista vuelve a ignorar created sin tocar backend.
- **Verification:**
  - npx jest orders-list-sse.service.spec --silent
  - node scripts/sse-smoke.mjs --type order.createdKeyframe (o curl -N al stream en dev)
- **Acceptance checklist:**
  - [x] created valido setea lastCreatedEvent+lastEvent → evidence/c1-karma-sse.log
  - [x] created invalido u otro type no toca signals ni rompe status_changed → c1-karma
  - [x] Reconnect backoff 1s-30s y close en destroy intactos → spec 13/13 verde
  - [x] Spec 13/13 SUCCESS incl. harness globalThis → evidence/c1-karma-sse.log
- **Status:** done · Rafael Eduardo Martinez Frontado · 2026-09-10 · evidence/c1-karma-sse.log

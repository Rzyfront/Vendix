---
id: A.1
title: "verificar emisores order created"
phase: A
status: pending
owner: none
updated: 2026-09-10
contracts: [FB-04, FB-05, FB-01]
adrs: [ADR-01]
skills: [vendix-backend-api, vendix-notifications-system, vendix-multi-tenant-context, how-to-dev]
---
# A.1 — verificar emisores order created

- **Skills:** vendix-backend-api, vendix-notifications-system, vendix-multi-tenant-context, how-to-dev
- **Resources:** apps/backend/src/domains/store/orders/orders.service.ts:596, checkout.service.ts:1629+2382, payments.service.ts:1427, order-sse.service.ts
- **Business decision:** No se cambia el protocolo SSE; solo se verifica que las 4 rutas emiten order.created con store_id y order_id correctos.
- **Why:** Si una ruta no emite, esa orden jamas aparece en vivo y el defecto es silencioso por tienda y por canal.
- **Output:** Matriz ruta-emite verificada + spec backend en verde + evidencia en evidence/a1-emitters.log.
- **Contracts touched:** FB-04, FB-05, FB-01
- **Data impact:** none — solo lectura de codigo y emision en memoria; sin migracion ni escritura directa.
- **Blast radius:** Bus SSE por tienda: un push mal formado contamina a todos los conectados de esa tienda.
- **Rollback:** Revert del commit de verificacion; sin cambio productivo no hay migracion que deshacer.
- **Verification:**
  - npx jest apps/backend/src/domains/store/orders/orders.service.spec.ts --silent
  - grep -rn "emit('order.created'" apps/backend/src --include="*.ts" | tee evidence/a1-emitters.log
- **Acceptance checklist:**
  - [ ] Las 4 rutas emiten order.created con store_id y order_id (evidencia en a1-emitters.log)
  - [ ] onOrderCreated llama pushOrderEvent con kind order.created y extra acotado
  - [ ] Subject indexado por store_id; emitir con store 0 se descarta sin crash
  - [ ] Spec backend en verde sin modificar contratos REST existentes
- **Status:** pending

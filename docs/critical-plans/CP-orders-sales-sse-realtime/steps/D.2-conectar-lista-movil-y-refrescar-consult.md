---
id: D.2
title: "conectar lista movil y refrescar consultas"
phase: D
status: done
owner: mobile-dev
updated: 2026-10-05
contracts: [FB-06, FB-07, FB-08, ERR-02]
adrs: [ADR-01, ADR-03]
skills: [mobile-dev, vendix-permissions, vendix-multi-tenant-context]
---
# D.2 — conectar lista movil y refrescar consultas

- **Skills:** mobile-dev, vendix-permissions, vendix-multi-tenant-context
- **Resources:** `apps/mobile/src/features/store/services/anuncios.service.ts`; `apps/mobile/src/core/auth/token.storage.ts`; `apps/mobile/src/core/auth/store-switcher.ts`; `npm run lint --prefix apps/mobile`
- **Business decision:** Un SSE válido es una señal para reconsultar REST, no una fila optimista; invalidar consultas solo de la tienda y sesión activas.
- **Why:** D.1 fija el contrato; este paso conecta el único consumidor móvil y actualiza la lista real sin duplicar filtros.
- **Output:** Servicio SSE móvil, endpoint constante, suscripción por foco/foreground en `orders.tsx`, invalidación de `['orders']` y `['order-stats']`, purga correcta al cambiar tienda.
- **Contracts touched:** FB-06, FB-07, FB-08, ERR-02
- **Data impact:** none — solo estado local React Query; ningún write a órdenes.
- **Blast radius:** Reconexiones duplicadas saturan el backend; un callback tardío contamina la caché de otra tienda.
- **Rollback:** Revertir los cambios de `apps/mobile/` de este paso; lista REST y pull-to-refresh vuelven a su estado anterior.
- **Verification:**
  - `npm run lint --prefix apps/mobile`
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`
- **Acceptance checklist:**
  - [x] Solo `order.created` y `order.status_changed` con `order_id` numérico disparan invalidación coalescida.
  - [x] Con foco y app activa existe una conexión; blur, background, logout y switch la cierran.
  - [x] Reconexión con backoff usa token vigente y reconsulta REST, porque el stream no tiene replay.
  - [x] Un 401 del stream activa la renovación JWT por REST o cierra sesión; no reintenta sin límite con token vencido.
  - [x] Sin `store:orders:read` no se abre stream; el backend conserva la autorización definitiva.
  - [x] Cambiar tienda y logout purgan `['orders']` y `['order-stats']`; callbacks viejos no contaminan la sesión nueva.
  - [x] Lint focal y TypeScript pasan; fallo del lint global y del spec backend amplio registrados en `evidence/d2-mobile-verification.md`.
- **Status:** done · mobile-dev · 2026-10-05 · compile y lint focal verdes; smoke API local

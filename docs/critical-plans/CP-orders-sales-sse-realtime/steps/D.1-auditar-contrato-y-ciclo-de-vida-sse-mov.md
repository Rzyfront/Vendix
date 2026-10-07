---
id: D.1
title: "auditar contrato y ciclo de vida SSE movil"
phase: D
status: done
owner: mobile-dev
updated: 2026-10-05
contracts: [FB-06, FB-07, FB-08, ERR-01, ERR-02]
adrs: [ADR-01, ADR-03]
skills: [mobile-dev, vendix-multi-tenant-context, vendix-permissions, how-to-test]
---
# D.1 — auditar contrato y ciclo de vida SSE movil

- **Skills:** mobile-dev, vendix-multi-tenant-context, vendix-permissions, how-to-test
- **Resources:** `rg -n 'order.created|order.status_changed|@Sse|@Permissions' apps/backend/src/domains/store/orders`; `rg -n 'queryKey|RefreshControl|EventSource' 'apps/mobile/app/(store-admin)/orders.tsx' apps/mobile/src/features/store/services/anuncios.service.ts`; `curl -N -G --data-urlencode "token=$JWT" "$API/store/orders/stream"`
- **Business decision:** El stream es de STORE_ADMIN y exige `store:orders:read`; no se interpreta el sonido push como prueba de actualización de lista.
- **Why:** Antes de abrir una conexión móvil hay que fijar contrato, permisos y ciclo de vida para no mostrar una tienda anterior.
- **Output:** Matriz en `evidence/d1-mobile-contract.md`: forma de evento, JWT, tienda activa, claves React Query, foco, background y token renovado.
- **Contracts touched:** FB-06, FB-07, FB-08, ERR-01, ERR-02
- **Data impact:** none — lectura de código y stream de desarrollo; sin mutación.
- **Blast radius:** Si se usa un token o storeId obsoleto, el cliente puede refrescar la tienda equivocada.
- **Rollback:** No hay código productivo en este paso; retirar la matriz si se invalida su evidencia.
- **Verification:**
  - `rg -n 'order.created|order.status_changed|stream' apps/backend/src/domains/store/orders/services/order-sse.service.ts apps/backend/src/domains/store/orders/orders.controller.ts`
  - `curl -N -G --data-urlencode "token=$JWT" "$API/store/orders/stream"` con JWT de prueba; registrar evento y HTTP sin guardar JWT.
- **Acceptance checklist:**
  - [x] `evidence/d1-mobile-contract.md` registra shape y aislamiento del stream, con evidencia de dev sin token.
  - [x] Identifica claves reales `['orders']` y `['order-stats']` y el staleTime de 30 s.
  - [x] Define cierre en blur/background/logout/switch y revalidación REST al reconectar.
- **Status:** done · mobile-dev · 2026-10-05 · contrato y auth verificados con curl local

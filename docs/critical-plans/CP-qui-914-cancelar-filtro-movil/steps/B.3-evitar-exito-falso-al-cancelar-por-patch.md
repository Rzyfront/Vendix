---
id: B.3
title: "evitar exito falso al cancelar por patch"
phase: B
status: in-progress
owner: none
updated: 2026-10-06
contracts: [FB-02, DB-01, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07]
adrs: [ADR-03]
skills: [sopus, vendix-backend, vendix-backend-api, vendix-error-handling, vendix-permissions, buildcheck-dev]
---
# B.3 — evitar exito falso al cancelar por patch

- **Skills:** sopus, vendix-backend, vendix-backend-api, vendix-error-handling, vendix-permissions, buildcheck-dev
- **Resources:** `apps/backend/src/domains/store/orders/orders.controller.ts`; `apps/backend/src/domains/store/orders/orders.controller.spec.ts`; `apps/backend/src/common/filters/http-exception.filter.ts`; `apps/backend/src/common/responses/response.service.ts`
- **Business decision:** La cancelación fallida debe tener un estado HTTP de error real; el cliente no debe mostrar un éxito falso.
- **Why:** El catch actual de `update()` devuelve `responseService.error()` para fallos inesperados, que puede salir con HTTP 200 y ser interpretado como éxito por Angular.
- **Output:** En `PATCH /store/orders/:id` con `state === 'cancelled'`, relanzar fallos no tipados al filtro global. Añadir spec para cancelación fallida, error tipado y PATCH no cancelatorio.
- **Contracts touched:** FB-02, DB-01, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07
- **Data impact:** none — se cambia la envoltura del error, no la transición ni sus escrituras.
- **Blast radius:** Un catch amplio puede modificar respuestas de edición no cancelatoria; un 200 residual puede mostrar éxito falso en órdenes.
- **Rollback:** Revertir solo la rama agregada y dejar evidencia del defecto legado; no revertir el flujo de dominio.
- **Verification:**
  - `cd apps/backend && NODE_OPTIONS=--max-old-space-size=4096 npx jest src/domains/store/orders/orders.controller.spec.ts --runInBand`
  - En dev, forzar un bloqueo tipado de cancelación y confirmar HTTP/código, orden intacta y toast de error.
- **Acceptance checklist:**
  - [x] Fallo no tipado al cancelar se relanza al filtro global — rama implementada; spec no compiló por TS2694 preexistente `sharp`, evidence/implementation-verification.md
  - [x] `VendixHttpException` conserva su HTTP y `error_code` en la cancelación — rethrow anterior permanece antes de la rama nueva
  - [x] Un PATCH que no cambia a `cancelled` conserva su comportamiento previo — rama condicional limitada a `state === 'cancelled'`; spec añadido pero no ejecutado
  - [ ] La UI no muestra toast de éxito ni recarga como éxito ante el fallo — pendiente E2E/error de respuesta real
  - [x] La transición y el permiso `store:orders:update` siguen en sus capas actuales — no se tocaron service ni decorator
  - [x] F-002 — Fallo de cancelación envuelto en HTTP 200 (major)
- **Status:** in-progress · orquestador · 2026-10-06 · spec bloqueado por dependencia `sharp`; falta UI runtime

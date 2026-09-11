---
id: B.2
title: "Cancelación limpia al iniciar nueva venta"
phase: B
status: done
owner: rzy
updated: 2026-09-10
contracts: []
adrs: [ADR-02]
skills: [vendix-frontend, vendix-zoneless-signals]
---
# B.2 — Cancelación limpia al iniciar nueva venta

- **Skills:** vendix-frontend, vendix-zoneless-signals
- **Resources:** apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts
- **Business decision:** Garantizar que si el cajero avanza a una nueva venta antes de que la DIAN responda, los temporizadores y llamadas de auto-impresión pendientes se limpien por completo.
- **Why:** Una llamada tardía de la DIAN recibida cuando el cajero ya está cobrando la siguiente venta podría lanzar una impresión involuntaria o corromper el estado del nuevo pedido.
- **Output:** Rutina `cleanupAutoPrintTimers()` invocada en `startNewSale()`, `onModalClosed()` y destrucción del componente.
- **Contracts touched:** none — Limpieza de timers y suscripciones en el ciclo de vida del componente
- **Data impact:** none — Gestión de memoria y ciclo de vida de timers.
- **Blast radius:** Mínimo; confinado a los eventos de cierre y reset del modal.
- **Rollback:** `git checkout HEAD -- apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts`
- **Verification:**
  - `npm run test -- apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.spec.ts`
- **Acceptance checklist:**
  - [x] Implementar función `cleanupAutoPrintTimers()` para despejar temporizador de 10s
  - [x] Resetear `awaitingFiscalPrint` y `fiscalFallbackNotice` en `startNewSale()`
  - [x] Invocar limpieza en `onModalClosed()` y en `destroyRef.onDestroy()`
  - [x] F-001 — Manejo de descarte del modal mientras la emision fiscal esta en espera (major)
- **Status:** done

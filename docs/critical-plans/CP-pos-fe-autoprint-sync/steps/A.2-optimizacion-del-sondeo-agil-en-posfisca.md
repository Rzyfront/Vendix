---
id: A.2
title: "Optimización del sondeo ágil en PosFiscalStatusComponent"
phase: A
status: done
owner: rzy
updated: 2026-09-10
contracts: [FB-01]
adrs: [ADR-03]
skills: [vendix-frontend, vendix-zoneless-signals]
---
# A.2 — Optimización del sondeo ágil en PosFiscalStatusComponent

- **Skills:** vendix-frontend, vendix-zoneless-signals
- **Resources:** apps/frontend/src/app/private/modules/store/pos/components/pos-fiscal-status.component.ts
- **Business decision:** Reducir la latencia de respuesta en mostrador acelerando el primer sondeo a 1500 ms y segundo a 2500 ms en lugar de esperar 5000 ms fijos.
- **Why:** Una espera de 5 segundos para obtener el tiquete en caja retrasa la atención en la fila cuando la DIAN responde normalmente en 1.5 a 2 segundos.
- **Output:** Cadencia de sondeo adaptativa en `PosFiscalStatusComponent` que acelera la detección del estado `issued`.
- **Contracts touched:** FB-01
- **Data impact:** none — Ajuste de temporizadores client-side para polling HTTP.
- **Blast radius:** Incremento menor de peticiones GET `/fiscal-status` por venta durante los primeros 4 segundos.
- **Rollback:** `git checkout HEAD -- apps/frontend/src/app/private/modules/store/pos/components/pos-fiscal-status.component.ts`
- **Verification:**
- `npm run test -- apps/frontend/src/app/private/modules/store/pos/components/pos-fiscal-status.component.spec.ts`
- **Acceptance checklist:**
  - [x] Reemplazar `POLL_MS` fijo de 5000ms por cadencia adaptativa (1500ms, 2500ms, 4000ms)
  - [x] Asegurar que `schedulePoll` cancele inmediatamente ante estado terminal
  - [x] Verificar que no se acumulen temporizadores huérfanos en `destroyRef`
- **Status:** done

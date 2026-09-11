---
id: C.2
title: "Sincronizar estado hasta payload y ticket"
phase: C
status: done
owner: rzy
updated: 2026-09-11
contracts: [FB-02, FB-03, DB-01]
adrs: [ADR-01, ADR-02]
skills: [vendix-frontend, vendix-zoneless-signals, vendix-frontend-state, parallel]
---
# C.2 — Sincronizar estado hasta payload y ticket

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-frontend-state, parallel
- **Resources:** `apps/frontend/src/app/private/modules/store/pos/pos.component.ts:837,1477-1514,1786,1860`
- **Business decision:** El checkout muestra y cobra lo mismo: ticket, confirmación y payload leen el mismo selectedCustomer resuelto.
- **Why:** Va tras C.1 porque el evento B ya existe; aquí se propaga a cart, señal padre y customer_id sin carreras.
- **Output:** `onCustomerSelected`→`setCustomer`→payload verificados con B y confirmación visual de B antes de cobrar.
- **Contracts touched:** FB-02, FB-03, DB-01
- **Data impact:** none — solo estado frontend y payload existente.
- **Blast radius:** Si falla, el ticket muestra B pero el POST lleva A; D.1 lo caza comparando ambos.
- **Rollback:** `git revert <sha>` del commit de sincronización; no toca backend ni DB.
- **Verification:**
  - `grep -n "customer_id: this.selectedCustomer" apps/frontend/src/app/private/modules/store/pos/pos.component.ts`
- **Acceptance checklist:**
  - [x] Emisión B→shell→padre→cart trazada sin intermediarios que borren
  - [x] Payload `pos` y `orders` leen selectedCustomer ya reemplazado
  - [x] Shell entra a resolve con carro=A + form lleno (hasFormIdentifiers)
  - [x] Scope commiteado: selector + shell + guard + spec (b3c1935)
  - [x] F-003 — shell salta resolveIfNeeded con cliente en carro (major) → evidence/post-change-probe-r2.txt
  - [x] F-005 — reemplazo A-B en delivery hereda direccion de A (major) → evidence/r2-fixes.txt
  - [x] F-006 — quitar cliente no desvincula el carro y factura a A (major) → evidence/r2-fixes.txt
  - [ ] F-009 — reemplazo en pickup conserva direccion y flip a delivery la reutiliza (minor)
- **Status:** done · rzy · 2026-09-11 · evidence/post-change-probe-r2.txt

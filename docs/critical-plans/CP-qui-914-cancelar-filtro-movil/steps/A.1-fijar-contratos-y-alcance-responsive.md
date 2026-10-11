---
id: A.1
title: "fijar contratos y alcance responsive"
phase: A
status: in-progress
owner: orquestador
updated: 2026-10-06
contracts: [FB-01, FB-02, FB-03, DB-01, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07]
adrs: [ADR-01, ADR-02, ADR-03]
skills: [vendix-frontend, vendix-frontend-data-display, vendix-permissions, how-to-test]
---
# A.1 — fijar contratos y alcance responsive

- **Skills:** vendix-frontend, vendix-frontend-data-display, vendix-permissions, how-to-test
- **Resources:** `rg -n 'cancelOrder|cancellation_policy|toggleDispatchable' apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts`; `sed -n '230,280p' apps/frontend/src/app/shared/components/item-list/item-list.component.html`; `sed -n '70,115p' apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.component.scss`
- **Business decision:** QUI-914 es web responsive STORE_ADMIN; la acción directa conserva la confirmación y el PATCH existentes.
- **Why:** El agente pequeño necesita un contrato cerrado antes de tocar componentes compartidos o la barra de filtros.
- **Output:** `evidence/a1-contracts.md` con capturas base y matriz de acciones, medidas, permisos y errores en dev.
- **Contracts touched:** FB-01, FB-02, FB-03, DB-01, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07
- **Data impact:** none — solo lectura del repositorio y observación de órdenes de desarrollo.
- **Blast radius:** Si se confunde la web responsive con Expo se edita el producto equivocado; si se ignora el gate se expone una acción prohibida.
- **Rollback:** Retirar la matriz y corregir el plan; este paso no cambia código.
- **Verification:**
  - `rg -n 'getVisibleActions\(item\).slice\(0, 2\)|getMenuActions' apps/frontend/src/app/shared/components/item-list/item-list.component.html`
  - Playwright MCP en `https://vendix.com/admin/orders/sales` a 375 y 700 px: registrar acciones y cajas antes de editar.
- **Acceptance checklist:**
  - [x] Distinguir acciones directas, menú y política `can_cancel` para órdenes cancelable/bloqueada mediante inspección estática; medición visual pendiente → evidence/a1-contracts.md
  - [ ] Confirmar 40/44 px de triggers y medida actual de «Por enviar» a 375/700 px en DOM; Playwright no disponible
  - [x] Registrar que `cancelOrder()` mantiene diálogo y `PATCH /store/orders/:id` → evidence/a1-contracts.md
  - [x] Registrar que el catch del PATCH puede envolver un fallo inesperado como HTTP 200 antes de B.3 → evidence/a1-contracts.md
  - [x] Completar `evidence/a1-contracts.md` con inspección estática y limitación de runtime
  - [ ] F-001 — Contrato de lectura y PATCH divergentes (major)
  - [ ] F-004 — Registrar errores fiscal y cocina (minor)
- **Status:** in-progress · orquestador · 2026-10-06 · baseline visual pendiente, Playwright MCP no disponible

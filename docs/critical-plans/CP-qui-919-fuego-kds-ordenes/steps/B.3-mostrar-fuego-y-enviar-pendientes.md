---
id: B.3
title: "mostrar fuego y enviar pendientes"
phase: B
status: in-progress
owner: ejecutor-pequeno
updated: 2026-10-06
contracts: [FB-01, FB-02, FB-03, FB-05, DB-02, DB-03, DB-04, DB-06, DB-07, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07, ERR-08, ERR-09, ERR-11, ERR-13]
adrs: [ADR-01, ADR-03]
skills: [sopus, vendix-frontend, vendix-zoneless-signals, vendix-frontend-data-display, vendix-ui-ux, vendix-restaurant-ops, vendix-permissions]
---
# B.3 — mostrar fuego y enviar pendientes

- **Skills:** sopus, vendix-frontend, vendix-zoneless-signals, vendix-frontend-data-display, vendix-ui-ux, vendix-restaurant-ops, vendix-permissions
- **Resources:** `apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts`; `apps/frontend/src/app/shared/components/table/README.md`; Playwright MCP
- **Business decision:** El clic envía solo platos pendientes; tras envío total el fuego es informativo y accesible.
- **Why:** Usar el POST existente protege inventario/COGS y evita reimplementar reglas de cocina.
- **Output:** Util pura de resumen, acción `flame` en tabla/tarjeta, POST único con guard en vuelo y feedback; impresión física existente y recuperación clara si falla.
- **Contracts touched:** FB-01, FB-02, FB-03, FB-05, DB-02, DB-03, DB-04, DB-06, DB-07, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07, ERR-08, ERR-09, ERR-11, ERR-13
- **Data impact:** Un POST real consume inventario en dev; no ejecutar en producción.
- **Blast radius:** Doble clic o ids obsoletos pueden producir ticket/stock incorrecto; color errado oculta platos.
- **Rollback:** Revertir acción/utilidad; un fire ya hecho requiere flujo operacional, no rollback UI.
- **Verification:**
  - `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadlessNoSandbox --include=src/app/private/modules/store/orders/components/orders-list/order-kitchen-summary.util.spec.ts`
  - Playwright 375/1024 px: un POST, tooltip y botón inerte tras fire.
- **Acceptance checklist:**
  - [ ] Cuello de botella probado con dos platos, parcial, quantity>1 y reenvío.
  - [ ] Solo ids elegibles viajan al POST; doble clic no duplica solicitud.
  - [ ] Sin permiso create no se ofrece acción; backend sigue rechazando 403.
  - [ ] Tras fire exitoso e impresión fallida, el aviso dice que ya se envió y guía a «Imprimir comanda» en detalle.
  - [ ] El mismo botón conserva foco; tras fire, Enter/toque solo muestra información, sin POST ni rowClick.
  - [ ] Pendiente ámbar; preparación azul; listo/entregado verde; cancelado sin verde.
  - [ ] F-006 — Indicador deshabilitado no accesible (major)
  - [ ] F-008 — Impresion fallida confunde con envio (minor)
- **Status:** in-progress · ejecutor-pequeno · 2026-10-06

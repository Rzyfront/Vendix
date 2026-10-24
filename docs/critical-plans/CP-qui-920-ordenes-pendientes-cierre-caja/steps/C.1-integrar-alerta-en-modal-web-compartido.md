---
id: C.1
title: "Integrar alerta en modal web compartido"
phase: C
status: in-progress
owner: none
updated: 2026-10-06
contracts: [FB-02, FB-03, FB-04, FB-05, FB-10, FB-11, FB-12, ERR-01, ERR-02, ERR-03, ERR-07, ERR-08, ERR-11]
adrs: [ADR-02, ADR-03]
skills: [vendix-frontend, vendix-frontend-component, vendix-zoneless-signals, vendix-ui-ux, vendix-frontend-routing]
---
# C.1 — Integrar alerta en modal web compartido

- **Skills:** vendix-frontend, vendix-frontend-component, vendix-zoneless-signals, vendix-ui-ux, vendix-frontend-routing
- **Resources:** npm run build --workspace=apps/frontend; Playwright MCP en https://vendix.com
- **Business decision:** El cierre muestra la lista y el modal de advertencia sólo si la sesión tiene órdenes pendientes por estado operativo o saldo por cobrar; sin órdenes, no muestra alerta aunque sea una sesión legacy. «Ver orden» navega al detalle en la misma pestaña.
- **Why:** Un cajero puede cerrar sin entender qué quedó abierto.
- **Output:** UI con señales, refresco paralelo de efectivo/lista, recuperación de 409, navegación y retorno seguro, reporte histórico.
- **Contracts touched:** FB-02, FB-03, FB-04, FB-05, FB-10, FB-11, FB-12, ERR-01, ERR-02, ERR-03, ERR-07, ERR-08, ERR-11
- **Data impact:** none — cambios de UI
- **Blast radius:** Un cajero puede cerrar sin entender qué quedó abierto.
- **Rollback:** Ocultar UI por flag; backend sigue guard.
- **Verification:**
  - `npm run build --workspace=apps/frontend`
- **Acceptance checklist:**
  - [ ] Banner no depende sólo de color y anuncia contador
  - [ ] Ver más expande/pagina; Ver orden navega a /admin/orders/:id y vuelve con lista fresca
  - [ ] Modal tiene title/aria-labelledby; foco vuelve al disparador y aviso se anuncia
  - [ ] 320/360 px y zoom 200% no desbordan lista, pie ni importes
  - [ ] Stale reabre revisión y efectivo sin cerrar
  - [ ] Confirmación separa elegibles/no elegibles, saldo y aclara que completar no cobra
  - [ ] Con cero pendientes no hay banner ni modal, incluso en sesión legacy
  - [ ] Ruta POS y /admin/cash-registers muestran mismo estado
  - [x] F-003 — Modal no distingue Ver más de Ver orden (major) → evidence/design-audit.md
  - [x] F-004 — Dialogo de cierre sin titulo accesible (major) → evidence/design-audit.md
- **Status:** in-progress

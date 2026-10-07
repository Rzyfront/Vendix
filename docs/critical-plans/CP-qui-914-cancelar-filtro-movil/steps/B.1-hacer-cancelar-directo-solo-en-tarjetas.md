---
id: B.1
title: "hacer cancelar directo solo en tarjetas"
phase: B
status: in-progress
owner: ejecutor-pequeno
updated: 2026-10-06
contracts: [FB-01, FB-02, DB-01, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06]
adrs: [ADR-01]
skills: [sopus, vendix-frontend, vendix-zoneless-signals, vendix-frontend-data-display, vendix-ui-ux, vendix-permissions]
---
# B.1 — hacer cancelar directo solo en tarjetas

- **Skills:** sopus, vendix-frontend, vendix-zoneless-signals, vendix-frontend-data-display, vendix-ui-ux, vendix-permissions
- **Resources:** `apps/frontend/src/app/shared/components/responsive-data-view/README.md`; `apps/frontend/src/app/shared/components/item-list/README.md`; `bash scripts/buildcheck.sh --watch`
- **Business decision:** La tarjeta móvil muestra View, Imprimir y Cancelar como tres botones directos, dejando Cancelar a la derecha; la tabla conserva View, Imprimir, Cancelar.
- **Why:** A.1 fija el comportamiento; el wrapper ya separa tabla y tarjeta, por lo que una entrada opcional evita duplicar el handler.
- **Output:** `ResponsiveDataViewComponent.mobileActions` opcional con fallback a `actions`, `mobileDirectActionsCount` default dos; lista móvil con Ver, Imprimir y Cancelar directos en ese orden, `rowLabelKey="order_number"` y etiqueta «Cancelar orden».
- **Contracts touched:** FB-01, FB-02, DB-01, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06
- **Data impact:** none — sin escritura nueva; se reutiliza el PATCH existente solo tras confirmar.
- **Blast radius:** Otras listas pueden perder acciones si el default cambia; una tarjeta puede abrir detalle por propagación si se evita el handler compartido.
- **Rollback:** Revertir únicamente `mobileActions` y el binding de la lista; la tarjeta vuelve al menú original.
- **Verification:**
  - `bash scripts/buildcheck.sh --watch` tras el último cambio, sin lanzar `ng build`.
  - Playwright MCP a 375 px: Cancelar visible en tarjeta permitida, ausente en bloqueada; tocarlo abre diálogo sin navegar.
- **Acceptance checklist:**
  - [x] La entrada nueva es opcional y su default conserva el arreglo original en otras listas — inspección estática, evidence/implementation-verification.md
  - [x] Cancelar es botón directo para `can_cancel === true`; se conserva `cancelOrder()` y su confirmación — inspección estática, evidence/a1-contracts.md
  - [ ] Orden bloqueada no muestra Cancelar; cierre de diálogo no envía PATCH — falta E2E
  - [ ] Clic de acción no abre detalle; desktop conserva orden View → Imprimir → Cancelar — desktop verificado por código, interacción falta E2E
  - [x] El botón anuncia «Cancelar orden: <número>»; el texto español también se muestra en escritorio sin alterar su acción — inspección estática
  - [x] Las tarjetas de órdenes renderizan Ver, Imprimir y Cancelar directos en ese orden, sin overflow de tres puntos; otras listas usan el default de dos — inspección estática
  - [x] Cambio integrado y revisado por el orquestador — diff local
  - [x] F-006 — Acción destructiva requiere número de orden (minor) → evidence/implementation-verification.md
  - [x] F-007 — Texto Cancel Order en interfaz española (minor) → evidence/implementation-verification.md
- **Status:** in-progress · orquestador · 2026-10-06 · faltan interacciones Playwright

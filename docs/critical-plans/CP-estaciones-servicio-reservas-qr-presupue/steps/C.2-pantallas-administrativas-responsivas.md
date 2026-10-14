---
id: C.2
title: "Pantallas administrativas responsivas"
phase: C
status: done
owner: Andres Meza
updated: 2026-10-14
contracts: [FB-01, FB-02, FB-03, FB-04, FB-23, FB-05, FB-06, FB-07, FB-10, FB-13, FB-14, FB-15, FB-18, FB-20, FB-21, FB-26, FB-22]
adrs: [ADR-01, ADR-04]
skills: [vendix-frontend, vendix-frontend-component, vendix-frontend-data-display, vendix-ui-ux, vendix-angular-forms, vendix-zoneless-signals]
---
# C.2 — Pantallas administrativas responsivas

- **Skills:** vendix-frontend, vendix-frontend-component, vendix-frontend-data-display, vendix-ui-ux, vendix-angular-forms, vendix-zoneless-signals
- **Resources:** npm run build --workspace=apps/frontend; Playwright MCP en vhost
- **Business decision:** La pantalla explica estación libre/reservada/ocupada y permite configurar compatibilidades, abrir atención y contactar cliente.
- **Why:** Un operador selecciona recurso incorrecto o no entiende aprobación.
- **Output:** Rutas/menú/permisos; selector en producto, agenda y POS; panel de sesión, propuesta, entrega y recuperación en orden.
- **Contracts touched:** FB-01, FB-02, FB-03, FB-04, FB-23, FB-05, FB-06, FB-07, FB-10, FB-13, FB-14, FB-15, FB-18, FB-20, FB-21, FB-26, FB-22
- **Data impact:** none — UI usa API
- **Blast radius:** Un operador selecciona recurso incorrecto o no entiende aprobación.
- **Rollback:** Ocultar menú por flag y volver a UI anterior.
- **Verification:**
  - `npm run build --workspace=apps/frontend`
- **Acceptance checklist:**
  - [x] POS exige estación y conserva `station_id` en carrito/editor → evidence/c2-static-flow-review.md
  - [x] Servicio indica si exige estación → evidence/c2-static-flow-review.md
  - [x] Filtro de proveedor limita estaciones compatibles → evidence/c2-static-flow-review.md
  - [x] Orden muestra tope configurado, pendiente de pago, propuestas por decidir y contacto → evidence/c2-static-flow-review.md
  - [x] Labels de búsqueda/calendario/Notas, foco de modal y controles accesibles añadidos → evidence/c2-static-flow-review.md
  - [x] Estado sin conexión/actualización y hora de último dato se anuncian → evidence/c2-static-flow-review.md
  - [x] F-010 — Pantallas sin recorrido accesible (major) → evidence/design-audit.md
  - [x] F-020 — Enlace a estaciones pierde etiqueta en móvil (minor) → evidence/implementation-notes.md
  - [x] F-025 — Panel oculta sesiones activas después de cien (major) → evidence/implementation-notes.md
- **Status:** done · 2026-10-14

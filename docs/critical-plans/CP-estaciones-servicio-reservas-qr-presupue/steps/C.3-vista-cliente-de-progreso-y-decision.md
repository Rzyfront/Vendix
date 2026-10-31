---
id: C.3
title: "Vista cliente de progreso y decisión"
phase: C
status: done
owner: Andres Meza
updated: 2026-10-14
contracts: [FB-16, FB-17, FB-19, DB-10, DB-13, DB-14, ERR-09, ERR-10, ERR-11, ERR-12]
adrs: [ADR-03, ADR-04]
skills: [vendix-frontend, vendix-customer-auth, vendix-ui-ux, vendix-zoneless-signals]
---
# C.3 — Vista cliente de progreso y decisión

- **Skills:** vendix-frontend, vendix-customer-auth, vendix-ui-ux, vendix-zoneless-signals
- **Resources:** npm run build --workspace=apps/frontend; Playwright MCP móvil
- **Business decision:** Cliente ve hitos y propuesta desglosada: líneas, impuestos, descuentos, incremento, total, tope, moneda y vencimiento; decide explícitamente sin revelar otras sesiones.
- **Why:** Aprobación accidental o fuga de datos en teléfono compartido.
- **Output:** Ruta storefront responsive, lectura SSE y consentimiento de propuesta con expiración clara.
- **Contracts touched:** FB-16, FB-17, FB-19, DB-10, DB-13, DB-14, ERR-09, ERR-10, ERR-11, ERR-12
- **Data impact:** Escribe decisión única; no modifica líneas desde browser.
- **Blast radius:** Aprobación accidental o fuga de datos en teléfono compartido.
- **Rollback:** Ocultar ruta, revocar tokens y mantener operación manual auditada.
- **Verification:**
  - `npm run build --workspace=apps/frontend`
- **Acceptance checklist:**
  - [x] QR/token abre la sesión enlazada; aislamiento validado por código → evidence/c3-static-privacy-offline-review.md
  - [x] Proyección pública muestra sólo presupuesto, propuesta y eventos públicos; sin notas internas ni datos de terceros → evidence/c3-static-privacy-offline-review.md
  - [x] Aprobar/rechazar usan modal compartido con foco/restauración y descripción accesible → evidence/implementation-notes.md
  - [x] Estado y nuevos eventos SSE se anuncian por `aria-live` → evidence/c3-static-privacy-offline-review.md
  - [x] Token vencido/revocado muestra salida clara y permite solicitar un enlace vigente → evidence/c3-static-privacy-offline-review.md
  - [x] Sin conexión o recargando snapshot las decisiones se bloquean; al volver conexión se actualiza snapshot y EventSource reabre el stream → evidence/c3-static-privacy-offline-review.md
  - [x] La propuesta visible incluye su versión y total → evidence/c3-static-privacy-offline-review.md
  - [x] F-008 — Consentimiento sin desglose legible (major) → evidence/design-audit.md
- **Status:** done

---
id: C.2
title: "Ficha de contrato y estados"
phase: C
status: done
owner: parallel-10
updated: 2026-09-06
contracts: [FB-07, ERR-06]
adrs: []
skills: [vendix-frontend, vendix-zoneless-signals, vendix-frontend-standard-module]
---
# C.2 — Ficha de contrato y estados

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-frontend-standard-module
- **Resources:** apps/frontend/src/app/private/modules/store/quotations/pages/quotation-detail/, modulo nuevo de contratos
- **Business decision:** El contrato se gestiona en borrador, vigente y facturado antes de facturar.
- **Why:** Entre aceptar y facturar hay gestion real (revisiones, firma, anticipos futuros); sin ficha no hay donde pararse.
- **Output:** Vista de contrato con estados, transiciones `draft->active->invoiced` y `*->cancelled`, trazabilidad a cotizacion y factura.
- **Contracts touched:** FB-07, ERR-06
- **Data impact:** none — lectura y transiciones via API; sin escrituras directas.
- **Blast radius:** Modulo nuevo (sin gating seria visible a todos: depende de A.2).
- **Rollback:** Ocultar modulo; los contratos siguen consistentes en backend.
- **Verification:**
  - Recorrer transiciones validas e invalidas contra API viva
  - Transicion invalida muestra mensaje con codigo, no pantalla en blanco
- **Acceptance checklist:**
  - [x] Ficha muestra objeto, A/I/U, totales y documentos origen (typecheck 0 errores; link a cotizacion + estado factura AIU)
  - [x] Solo transiciones validas habilitadas por estado (botones = `validTransitions()`; matriz 18/18 en evidence/C.2-ficha-evidence.md)
  - [x] Error de transicion es legible y accionable (banner + toast con codigo `CONTRACT_STATUS_001`; contra API viva queda para C.1/E.1 — controlador aun inexistente)
- **Status:** done (degradado por C.1 pendiente en backend; evidencia en evidence/C.2-ficha-evidence.md)

---
id: D.2
title: "Boton generar factura AIU"
phase: D
status: done
owner: parallel-13
updated: 2026-09-06
contracts: [FB-08, FB-09]
adrs: []
skills: [vendix-frontend, vendix-zoneless-signals]
---
# D.2 — Boton generar factura AIU

- **Skills:** vendix-frontend, vendix-zoneless-signals
- **Resources:** Ficha de contrato (C.2), invoice-create-page, invoice-aiu-settings.service.ts
- **Business decision:** El boton vive en el contrato vigente y abre la factura precargada editable.
- **Why:** El operador factura desde donde gestiona, sin reescribir datos ni cambiar de modulo.
- **Output:** Boton con estados (habilitado solo en `active` sin factura), apertura del borrador y manejo del 409 si ya existe.
- **Contracts touched:** FB-08, FB-09
- **Data impact:** none — delega la escritura al backend atomico de D.1.
- **Blast radius:** Ficha de contrato. Doble clic debe deshabilitarse mientras responde el backend.
- **Rollback:** Ocultar boton; la API sigue siendo la unica via de creacion.
- **Verification:**
  - Doble clic rapido genera una sola factura (boton se bloquea + backend 409)
  - Contrato ya facturado muestra enlace a factura en vez del boton
- **Acceptance checklist:**
  - [x] Boton solo visible y activo en contrato vigente sin factura (`canGenerateContractInvoice()` 7/7 en evidence/D.2-boton-factura-evidence.md; typecheck 0 errores)
  - [x] Abre borrador precargado listo para revisar y emitir (navega a `/admin/invoicing/invoices` tras POST; contra API viva queda para D.1/E.1 — endpoint aun inexistente)
  - [x] Estado 409 se muestra como "ya facturado" con enlace (rama 409/codigo + banner con accion "Ver facturas"; contra API viva queda para D.1/E.1)
- **Status:** done (degradado por D.1 pendiente en backend; evidencia en evidence/D.2-boton-factura-evidence.md)

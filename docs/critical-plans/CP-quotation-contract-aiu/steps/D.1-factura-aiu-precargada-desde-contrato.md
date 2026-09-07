---
id: D.1
title: "Factura AIU precargada desde contrato"
phase: D
status: done
owner: parallel-12
updated: 2026-09-06
contracts: [DB-05, FB-08, ERR-07]
adrs: [ADR-03]
skills: [vendix-tax-typing, vendix-backend-domain, vendix-prisma-scopes]
---
# D.1 — Factura AIU precargada desde contrato

- **Skills:** vendix-tax-typing, vendix-backend-domain, vendix-prisma-scopes
- **Resources:** apps/backend/src/domains/store/invoicing/invoicing.service.ts:1807 (createFromOrder, patron), invoice-calculator.service.ts, invoice-flow.service.ts
- **Business decision:** Contrato vigente genera borrador de factura AIU con objeto, regimen y matriz ya cargados.
- **Why:** Precargar desde el snapshot elimina el error manual en la base gravable, que es donde duelen los rechazos DIAN.
- **Output:** `createInvoice` atomico (factura draft + contrato a `invoiced`), `invoices.contract_id` FK, una sola factura activa por contrato.
- **Contracts touched:** DB-05, FB-08, ERR-07
- **Data impact:** Una fila de factura en draft por contrato; transicion atomica impide doble facturacion. Sin tocar facturas existentes.
- **Blast radius:** Emision AIU. Una matriz mal copiada produciria documento fiscal incorrecto: la precarga se verifica contra el snapshot.
- **Rollback:** Anular borrador no emitido segun flujo DIAN vigente; contrato vuelve a `active` solo por via auditada.
- **Verification:**
  - Matriz AIU de la factura igual al snapshot del contrato (comparacion campo a campo)
  - Segundo intento responde 409/422 y no crea fila
- **Acceptance checklist:**
  - [x] Borrador nace editable antes de emitir a DIAN (status `draft`; `update()` intacto lo edita; probado: el creado sale `draft`)
  - [x] Emitir sin editar pasa validacion de piso AIU (solo-AIU ⇒ AIU = 100 % de sus lineas ≥ piso 10 %; matriz con `taxable_without_rate: []` y cero divergencias del calculador real en el spec)
  - [x] Doble generacion bloqueada y probada (capas 1+2 + UNIQUE parcial→P2002→409 `CONTRACT_INVOICE_001`; 6 casos en `invoicing.service.contract-invoice.spec.ts`)
- **Status:** done — ver `evidence/D.1-factura-aiu-evidence.md` (gaps honestos: sin DB viva, endpoint FB-08 es D.2, contratos sin A/I/U no precargan por decision documentada)

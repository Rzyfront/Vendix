---
id: C.1
title: "Crear contrato desde cotizacion"
phase: C
status: done
owner: workflow-C.1
updated: 2026-09-06
contracts: [DB-04, FB-06, ERR-01, ERR-05]
adrs: [ADR-01, ADR-03, ADR-04]
skills: [vendix-backend-domain, vendix-prisma-migrations, vendix-prisma-scopes]
---
# C.1 — Crear contrato desde cotizacion

- **Skills:** vendix-backend-domain, vendix-prisma-migrations, vendix-prisma-scopes
- **Resources:** apps/backend/src/domains/store/quotations/quotations.service.ts:440 (convertToOrder, NO tocar), orders.service, schema.prisma
- **Business decision:** Aceptada con destino `contract` crea la ficha del contrato; `convertToOrder` queda intacto y bloqueado para ese destino.
- **Why:** La aceptacion es el momento juridico donde nace el compromiso; crearlo antes seria gestionar humo.
- **Output:** `ContractsService.createFromQuotation` idempotente + estado `contracted` + `contracts` con snapshot AIU y numero propio por store.
- **Contracts touched:** DB-04, FB-06, ERR-01, ERR-05
- **Data impact:** Filas nuevas en `contracts`; `quotations` solo marca estado y `contract_id`. `quotation_id` unique impide duplicados.
- **Blast radius:** Conversion a contrato. Doble clic o reintento no debe crear 2 contratos (unique + transaccion).
- **Rollback:** Cancelar contrato (`cancelled`) sin borrar historia; la cotizacion queda en `contracted` con trazabilidad.
- **Verification:**
  - Doble `POST` concurrente crea un solo contrato (segundo 409/422)
  - `convertToOrder` sobre destino `contract` responde error explicito
- **Acceptance checklist:**
  - [x] Aceptada-contrato crea ficha con items, totales y snapshot AIU
  - [x] Reintento no duplica (unique `contracts.quotation_id` + triple capa 409; choque real contra DB viva queda para E.1)
  - [x] Venta sigue usando `converted` sin cambios (`convertToOrder` intacto, build + specs vecinos verdes)
  - [ ] F-002 — VALID_TRANSITIONS sin contracted ni contracted_at (minor)
- **Status:** done · workflow-C.1 · 2026-09-06 · evidence/C.1-contracts-evidence.md

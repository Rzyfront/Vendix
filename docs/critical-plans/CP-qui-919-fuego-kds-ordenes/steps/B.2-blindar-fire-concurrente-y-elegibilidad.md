---
id: B.2
title: "blindar fire concurrente y elegibilidad"
phase: B
status: in-progress
owner: ejecutor-pequeno
updated: 2026-10-06
contracts: [FB-03, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, ERR-01, ERR-02, ERR-03, ERR-04, ERR-06, ERR-07, ERR-08, ERR-09, ERR-11]
adrs: [ADR-01]
skills: [sopus, vendix-backend, vendix-prisma-scopes, vendix-restaurant-ops, vendix-inventory-stock, vendix-error-handling, vendix-permissions, buildcheck-dev]
---
# B.2 — blindar fire concurrente y elegibilidad

- **Skills:** sopus, vendix-backend, vendix-prisma-scopes, vendix-restaurant-ops, vendix-inventory-stock, vendix-error-handling, vendix-permissions, buildcheck-dev
- **Resources:** `apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts`; `apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.spec.ts`; `apps/backend/src/common/errors/error-codes.ts`; `npm run buildcheck:test -- src/domains/store/kitchen-fire/kitchen-fire.service.spec.ts`
- **Business decision:** El backend impide dos fires del mismo plato y rechaza `skip_kds` o estados terminales antes de consumir stock, aunque el cliente esté obsoleto.
- **Why:** El servicio actual filtra la bandera antes de la transacción y no reclama la línea dentro; dos POST simultáneos pueden consumir dos veces. Tampoco valida `skip_kds` ni estado terminal en fire manual.
- **Output:** Reclamación/revalidación transaccional de cada ítem antes de BOM/stock/ticket, validación de elegibilidad y spec concurrente. Preservar reenvío explícito y auto-fire.
- **Contracts touched:** FB-03, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, ERR-01, ERR-02, ERR-03, ERR-04, ERR-06, ERR-07, ERR-08, ERR-09, ERR-11
- **Data impact:** En fixture dev, solo un POST de dos concurrentes debe consumir y crear ticket; el perdedor no muta.
- **Blast radius:** Reclamo demasiado amplio bloquea POS auto-fire o resend; reclamo tardío deja doble COGS.
- **Rollback:** No publicar la acción nueva si no pasa el guard; revertir cambio de servicio solo junto con la acción de QUI-919.
- **Verification:**
  - `npm run buildcheck:test -- src/domains/store/kitchen-fire/kitchen-fire.service.spec.ts`
  - Dos POST concurrentes controlados en dev: un resultado efectivo, un rechazo 409, un ticket, un consumo y un evento `kitchen_fired`.
- **Acceptance checklist:**
  - [ ] Reclamar/releer ítems bajo transacción antes de cualquier efecto económico, con `store_id` y orden actual.
  - [ ] Rechazar `skip_kds`, cancelado/reembolsado e ítems cancelados; no cambiar semántica de resend.
  - [ ] Dos clientes concurrentes producen una sola mutación y un fallo 409 tipado del perdedor.
  - [ ] Stock, ticket, flag y evento son atómicos; fallo revierte todo.
  - [ ] Specs de POS auto-fire y resend existentes permanecen verdes.
  - [ ] F-001 — Fire concurrente duplica consumo (blocker)
  - [ ] F-002 — Fire no valida skip KDS ni estado terminal (major)
- **Status:** in-progress · ejecutor-pequeno · 2026-10-06

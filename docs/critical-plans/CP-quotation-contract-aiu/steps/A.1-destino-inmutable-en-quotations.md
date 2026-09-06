---
id: A.1
title: "Destino inmutable en quotations"
phase: A
status: done
owner: agent-2
updated: 2026-09-06
contracts: [DB-01, FB-01, ERR-01, ERR-02]
adrs: [ADR-01]
skills: [vendix-backend-api, vendix-validation, vendix-prisma-migrations]
---
# A.1 — Destino inmutable en quotations

- **Skills:** vendix-backend-api, vendix-validation, vendix-prisma-migrations
- **Resources:** apps/backend/src/domains/store/quotations/dto/create-quotation.dto.ts, update-quotation.dto.ts, quotations.service.ts:278, schema.prisma
- **Business decision:** `destination` se fija al crear y jamas se edita (ADR-01).
- **Why:** Un contrato AIU no cabe en una orden de venta; editar el destino permitiria doble conversion y doble ingreso.
- **Output:** Columna `destination` + enum con default `sale`; `update` rechaza cambios de destino; migracion propia con header DATA IMPACT.
- **Contracts touched:** DB-01, FB-01, ERR-01, ERR-02
- **Data impact:** Columna nueva con default `sale`: cero filas existentes cambian de comportamiento. Sin backfill.
- **Blast radius:** Crear/editar cotizacion. Si el default falla, toda cotizacion nueva nace rota y se detecta al crear.
- **Rollback:** Revertir migracion antes de datos nuevos; con datos, migracion compensa (ver Data Integrity Plan).
- **Verification:**
  - Crear cotizacion sin destino y confirmar `destination=sale` en la respuesta
  - Intentar `PATCH` de destino y confirmar 422 con codigo registrado
- **Acceptance checklist:**
  - [x] Sin destino nace `sale` y fluye a orden como hoy
  - [x] Cambio de destino responde 422 con codigo ERR-01
  - [x] Migracion lleva header DATA IMPACT y pasa en dataset representativo
- **Status:** done (evidencia en evidence/A.1-destination-evidence.md)

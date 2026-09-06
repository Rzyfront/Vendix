---
id: B.1
title: "Backend de perfiles de cotizacion"
phase: B
status: done
owner: workflow-parallel-6
updated: 2026-09-06
contracts: [DB-02, DB-03, FB-03, FB-04, ERR-04]
adrs: [ADR-03]
skills: [vendix-backend-domain, vendix-backend-api, vendix-prisma-migrations, vendix-multi-tenant-context]
---
# B.1 — Backend de perfiles de cotizacion

- **Skills:** vendix-backend-domain, vendix-backend-api, vendix-prisma-migrations, vendix-multi-tenant-context
- **Resources:** apps/backend/src/domains/store/invoicing/profiles/profiles.service.ts (patron a espejar), schema.prisma, dto de perfiles de factura
- **Business decision:** Perfiles de cotizacion opcionales por store, versionados, espejo del patron de factura.
- **Why:** Quien quiere usa perfil, quien no cotiza desde cero; el versionado congela con que numeros se cito.
- **Output:** `quotation_profiles` + `quotation_profile_versions`, CRUD con default unico por store, catalogo sin paginar, nombre unico por store.
- **Contracts touched:** DB-02, DB-03, FB-03, FB-04, ERR-04
- **Data impact:** Tablas nuevas vacias: cero efecto en datos existentes. `quotations.profile_id` nullable.
- **Blast radius:** Solo superficies nuevas de perfiles; facturacion y cotizacion actual no se tocan.
- **Rollback:** Eliminar modulo y tablas nuevas si no hay referencias; con uso, desactivar por `state`.
- **Verification:**
  - CRUD de perfil + `is_default` unico + 409 en nombre duplicado por store
  - `update` crea version nueva y mueve puntero sin reescribir historia
- **Acceptance checklist:**
  - [x] Perfil se crea, clona, activa y desactiva por store
  - [x] Nombre duplicado por store responde 409
  - [x] Editar no reescribe versiones viejas
- **Status:** done — ver `evidence/B.1-profiles-evidence.md`

---
id: B.1
title: "Exponer lista autoritativa de pendientes"
phase: B
status: done
owner: none
updated: 2026-10-06
contracts: [FB-04, FB-10, FB-15, DB-01, DB-02, DB-04, DB-10, ERR-04, ERR-12]
adrs: [ADR-01, ADR-02]
skills: [vendix-backend, vendix-backend-api, vendix-permissions, vendix-error-handling, vendix-prisma-scopes]
---
# B.1 — Exponer lista autoritativa de pendientes

- **Skills:** vendix-backend, vendix-backend-api, vendix-permissions, vendix-error-handling, vendix-prisma-scopes
- **Resources:** bash evidence/verify-fb.sh FB-04; bash evidence/verify-err.sh ERR-12
- **Business decision:** La alerta lista sólo órdenes de esta sesión, con motivos diferenciados y snapshot paginado; no incluye toda la tienda.
- **Why:** Una consulta lenta o global confunde caja y bloquea cierre.
- **Output:** GET pending-orders con count, sumas informativas, page, state, balance, motivos, fingerprint y link seguro.
- **Contracts touched:** FB-04, FB-10, FB-15, DB-01, DB-02, DB-04, DB-10, ERR-04, ERR-12
- **Data impact:** Lectura acotada por store+session; sin cambio de importes.
- **Blast radius:** Una consulta lenta o global confunde caja y bloquea cierre.
- **Rollback:** Deshabilitar lista y cerrar sólo por flujo auditado; no borrar órdenes.
- **Verification:**
  - `bash evidence/verify-fb.sh FB-04`
- **Acceptance checklist:**
  - [x] Dos cajas de la misma tienda dan listas distintas
  - [x] Draft sin movimiento aparece si tiene origen
  - [x] COD no se suma a efectivo esperado
  - [x] Lista paginada y contador usan mismo predicado
  - [x] Sesión ajena responde 404/403 sin filtrar datos
- **Status:** done

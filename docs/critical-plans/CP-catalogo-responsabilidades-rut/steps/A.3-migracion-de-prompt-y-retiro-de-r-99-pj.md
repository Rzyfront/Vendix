---
id: A.3
title: "Migracion de prompt y retiro de R-99-PJ con reparacion de datos"
phase: A
status: done
owner: none
updated: 2026-09-09
contracts: [DB-01, DB-02, DB-03, DB-04, DB-05, ERR-01, ERR-02]
adrs: [ADR-04]
skills: [vendix-prisma-migrations, vendix-backend, vendix-fiscal-scope]
---
# A.3 — Migracion de prompt y retiro de R-99-PJ con reparacion de datos

- **Skills:** vendix-prisma-migrations, vendix-backend, vendix-fiscal-scope
- **Resources:** `npx prisma migrate dev --name retire-r99-pj`
- **Business decision:** `R-99-PJ` nunca existió ante la DIAN: se reescribe a `R-99-PN` (fallback que ya usa el firewall UBL) en users, organizations y fiscal_data, y se re-sincroniza el espejo de organizations.
- **Why:** Va después de A.1/A.2 porque necesita el canónico ampliado y el prompt nuevo; sin este paso los datos históricos conservan un código inexistente que el validador estricto rechazaría al re-guardar.
- **Output:** Migración con header DATA IMPACT, conteos antes/después y salida del dry-run en evidence/.
- **Contracts touched:** DB-01, DB-02, DB-03, DB-04, DB-05, ERR-01, ERR-02
- **Data impact:** Reescribe R-99-PJ a R-99-PN en arreglos users/organizations/fiscal_data y 1 fila de prompt; sin deletes ni truncates.
- **Blast radius:** Clientes y comercios creados por escaneo cuando el prompt emitía R-99-PJ; facturas ya emitidas no se reabren.
- **Rollback:** Down migration restaura valores desde tabla de respaldo creada en el propio SQL.
- **Verification:**
  - `SELECT count(*) FROM users WHERE 'R-99-PJ' = ANY (fiscal_responsibilities);` debe dar 0 tras migrar
- **Acceptance checklist:**
  - [x] Respaldar conteos de `R-99-PJ` por tabla antes de migrar.
  - [x] UPDATE del prompt solo si aún contiene la lista restrictiva.
  - [x] Reemplazar `R-99-PJ` por `R-99-PN` en users, organizations y fiscal_data.
  - [x] Re-sincronizar `organizations.fiscal_responsibilities` con fiscal_data.
  - [x] Dry-run sobre dataset representativo, nunca sobre DB vacía.
  - [x] Adjuntar salida del dry-run en `evidence/a3-dry-run.txt`.
- **Status:** done

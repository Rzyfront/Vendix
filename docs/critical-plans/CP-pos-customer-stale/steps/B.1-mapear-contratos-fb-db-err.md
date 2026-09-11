---
id: B.1
title: "Mapear contratos FB DB ERR"
phase: B
status: done
owner: rzy
updated: 2026-09-11
contracts: [FB-01, FB-02, FB-03, FB-04, FB-05, FB-06, FB-07, FB-08, DB-01, DB-02, DB-03, ERR-01, ERR-02, ERR-03, ERR-04]
adrs: []
skills: [vendix-backend-api, vendix-validation, vendix-multi-tenant-context, vendix-prisma-scopes, vendix-error-handling]
---
# B.1 — Mapear contratos FB DB ERR

- **Skills:** vendix-backend-api, vendix-validation, vendix-multi-tenant-context, vendix-prisma-scopes, vendix-error-handling
- **Resources:** `grep -rn "customer_id" apps/backend/src/domains/store/payments apps/backend/src/domains/store/invoicing --include="*.ts"`
- **Business decision:** Contrato no enumerado es contrato roto en producción; la factura hereda el customer de la orden sin adivinar.
- **Why:** Va tras A.1 porque el diseño del fix solo es seguro contra contratos enumerados; antes del código, nunca después.
- **Output:** `registry/fb.md` con 8 filas, `db.md` con 3, `err.md` con 4, cada fila con verificación runnable.
- **Contracts touched:** FB-01, FB-02, FB-03, FB-04, FB-05, FB-06, FB-07, FB-08, DB-01, DB-02, DB-03, ERR-01, ERR-02, ERR-03, ERR-04
- **Data impact:** none — read-only mapping step.
- **Blast radius:** Si falta una fila, el fix puede cambiar un campo que otro flujo lee y degradar cotización o separé.
- **Rollback:** Completar el registry; no hay código que revertir en este paso.
- **Verification:**
  - `bash skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-pos-customer-stale`
- **Acceptance checklist:**
  - [x] 8 filas FB con Change y Verification runnable
  - [x] 3 filas DB con scoping e invariante
  - [x] 4 filas ERR con comportamiento frontend
  - [x] Ninguna fila supera 400 chars (lint lo valida)
  - [x] `cp-lint.sh` exit 0 (0 fallas, ver E.1)
- **Status:** done · rzy · 2026-09-11 · registry/fb.md,db.md,err.md

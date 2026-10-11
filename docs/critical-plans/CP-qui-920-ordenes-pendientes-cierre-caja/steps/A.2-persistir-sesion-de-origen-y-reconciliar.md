---
id: A.2
title: "Persistir sesion de origen y reconciliar legacy"
phase: A
status: in-progress
owner: none
updated: 2026-10-06
contracts: [FB-01, FB-06, FB-07, FB-08, FB-09, DB-01, DB-03, DB-09, DB-10, ERR-04, ERR-12]
adrs: [ADR-01]
skills: [vendix-prisma-schema, vendix-prisma-migrations, vendix-prisma-scopes, vendix-multi-tenant-context]
---
# A.2 — Persistir sesion de origen y reconciliar legacy

- **Skills:** vendix-prisma-schema, vendix-prisma-migrations, vendix-prisma-scopes, vendix-multi-tenant-context
- **Resources:** npx prisma validate --schema apps/backend/prisma/schema.prisma; bash evidence/verify-db.sh DB-01
- **Business decision:** La sesión origen se fija al crear POS bajo caja abierta; pago en otra caja no la mueve. El primer movimiento de venta solo acredita dónde se cobró, no dónde se creó; no asignar sesiones a legacy sin evidencia de creación.
- **Why:** Una FK equivocada mezcla cajas y oculta órdenes abiertas.
- **Output:** Migración nullable/indexada, flag de tracking por sesión, guard de misma tienda y atribución al crear POS; editor/pago conserva origen; reporte de legacy sin backfill.
- **Contracts touched:** FB-01, FB-06, FB-07, FB-08, FB-09, DB-01, DB-03, DB-09, DB-10, ERR-04, ERR-12
- **Data impact:** Escribe nueva FK en órdenes, no altera órdenes ambiguas.
- **Blast radius:** Una FK equivocada mezcla cajas y oculta órdenes abiertas.
- **Rollback:** Desactivar gate, mantener columna nullable y restaurar asignaciones sólo con snapshot auditado.
- **Verification:**
  - `npx prisma validate --schema apps/backend/prisma/schema.prisma`
- **Acceptance checklist:**
  - [ ] Migración lleva DATA IMPACT y pasa en clon con varias cajas
  - [ ] Origen es inmutable y misma tienda
  - [ ] Sesiones existentes quedan con tracking desactivado y el código de apertura nueva activa tracking
  - [ ] Draft sin caja conserva null y se ve como excepción
  - [x] La orden borrador creada al abrir una mesa desde POS se atribuye a la caja abierta; mesa QR sigue sin atribución implícita
  - [ ] Pago posterior en otra sesión no reasigna origen
  - [x] Legacy sin evidencia de creación permanece sin atribuir y no se asigna desde el primer movimiento de venta
  - [x] F-007 — Primer movimiento de venta no prueba sesión de origen (blocker)
- **Status:** in-progress

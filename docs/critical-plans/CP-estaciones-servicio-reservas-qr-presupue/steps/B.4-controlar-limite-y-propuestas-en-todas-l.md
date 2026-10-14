---
id: B.4
title: "Controlar límite y propuestas en todas las órdenes"
phase: B
status: done
owner: Andres Meza
updated: 2026-10-14
contracts: [FB-11, FB-24, FB-25, FB-47, FB-48, FB-42, FB-43, FB-18, FB-19, FB-20, DB-12, DB-13, DB-14, DB-16, DB-18, ERR-08, ERR-09, ERR-10, ERR-11]
adrs: [ADR-04]
skills: [vendix-business-analysis, vendix-backend, vendix-inventory-stock, vendix-auto-entries, vendix-error-handling]
---
# B.4 — Controlar límite y propuestas en todas las órdenes

- **Skills:** vendix-business-analysis, vendix-backend, vendix-inventory-stock, vendix-auto-entries, vendix-error-handling
- **Resources:** npx jest orders budget --runInBand; curl writers
- **Business decision:** El total final autorizado se calcula en servidor; propuesta excedente espera consentimiento y no genera stock/cobro/contabilidad.
- **Why:** Un escritor alterno puede cobrar excedente sin permiso.
- **Output:** Guard central de orden, propuesta inmutable de líneas, impuestos, descuentos, moneda y total; versión monótona de orden; decisión auditada e historial; orden inmutable ante aprobación vieja.
- **Contracts touched:** FB-11, FB-24, FB-25, FB-47, FB-48, FB-42, FB-43, FB-18, FB-19, FB-20, DB-12, DB-13, DB-14, DB-16, DB-18, ERR-08, ERR-09, ERR-10, ERR-11
- **Data impact:** Escribe presupuesto, propuestas y decisiones; sólo tras aprobación muta líneas.
- **Blast radius:** Un escritor alterno puede cobrar excedente sin permiso.
- **Rollback:** Desactivar nuevas adiciones y conciliar eventos/stock; no borrar decisiones.
- **Verification:**
  - `npx jest orders budget --runInBand`
- **Acceptance checklist:**
  - [x] POST orden, PUT items/editor, POS, mesa, pagos y checkout aplican mismo guard cuando hay sesión
  - [x] Una aprobación vincula importe y versión exactos
  - [x] Rechazo o expiración no muta orden
  - [x] Lock/CAS de versión serializa propuesta, cálculo y aplicación
  - [x] Dos aprobaciones concurrentes aplican una sola vez (diseñado con Serializable/CAS y status pending guard)
  - [x] F-003 — Aprobación sin versión y snapshot (blocker) → evidence/design-audit.md
  - [x] F-011 — Rutas de orden y pago sin guard (blocker) → evidence/design-audit.md
  - [x] F-017 — Aprobación de propuesta registraba consentimiento pero no aplicaba líneas ni stock (major) → evidence/implementation-notes.md
- **Status:** done · 2026-10-14

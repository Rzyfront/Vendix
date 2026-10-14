---
id: B.4
title: "Cerrar con guard transaccional y snapshot"
phase: B
status: in-progress
owner: none
updated: 2026-10-06
contracts: [FB-02, FB-03, FB-04, FB-05, FB-15, FB-16, FB-17, FB-18, DB-01, DB-02, DB-03, ERR-01, ERR-02, ERR-03, ERR-05, ERR-06, ERR-11, ERR-13]
adrs: [ADR-01, ADR-02]
skills: [vendix-backend, vendix-error-handling, vendix-permissions, vendix-analytics-metrics]
---
# B.4 — Cerrar con guard transaccional y snapshot

- **Skills:** vendix-backend, vendix-error-handling, vendix-permissions, vendix-analytics-metrics
- **Resources:** bash evidence/verify-fb.sh FB-05; npx jest sessions.service --runInBand
- **Business decision:** Sin pendientes devueltos: cierre normal, también para sesión legacy sin tracking. Con pendientes por estado operativo o saldo: aviso modal con icono visible; confirmar permite cerrar, conserva fingerprint fresco y guarda motivo de auditoría generado por sistema; no toca órdenes.
- **Why:** Una carrera puede cerrar sin avisar o alterar esperado.
- **Output:** CloseSessionDto/Service conserva expected_seen, cálculo de efectivo y pendientes dentro de transacción; lock compartido con órdenes y todos los movimientos, 409 stale, resumen congelado y evento contable una vez.
- **Contracts touched:** FB-02, FB-03, FB-04, FB-05, FB-15, FB-16, FB-17, FB-18, DB-01, DB-02, DB-03, DB-11, ERR-01, ERR-02, ERR-03, ERR-05, ERR-06, ERR-11, ERR-13
- **Data impact:** Escribe cierre y snapshot en summary; efectivo sigue movimientos.
- **Blast radius:** Una carrera puede cerrar sin avisar o alterar esperado.
- **Rollback:** Flag off sólo tras plan de compatibilidad; conservar snapshot y movimientos para auditoría.
- **Verification:**
  - `npx jest sessions.service --runInBand`
- **Acceptance checklist:**
  - [x] Cliente API sin pending_decision no cierra con pendientes
  - [x] Cambio de orden o movimiento invalida fingerprint/expected_seen
  - [ ] Crear orden, pagar, refund, cash_in/out y cerrar comparten lock; mutar orden espera lock de fila
  - [ ] Cobro exitoso nunca pierde movimiento de caja por carrera con cierre
  - [x] Confirmación conserva IDs/estados/saldos/motivo de auditoría/actor/hora
  - [x] Reporte antiguo no se recalcula con estado actual
  - [x] F-001 — Movimiento entre lectura y cierre (blocker) → evidence/design-audit.md
  - [ ] F-006 — Escritores post-commit impiden lock común de caja (blocker)
- **Status:** in-progress

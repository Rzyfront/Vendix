---
id: B.2
title: "Cerrar todas las rutas de reserva y checkout"
phase: B
status: done
owner: Andres Meza
updated: 2026-10-14
contracts: [FB-07, FB-08, FB-09, FB-10, FB-11, FB-12, FB-27, FB-28, FB-29, FB-30, FB-31, FB-32, FB-33, FB-34, FB-35, FB-36, FB-37, FB-38, FB-39, FB-40, FB-41, FB-44, FB-45, FB-46, DB-06, DB-07, DB-20, DB-16, ERR-02, ERR-03, ERR-15, ERR-17, ERR-18, ERR-20, ERR-21]
adrs: [ADR-02]
skills: [vendix-backend, vendix-ecommerce-checkout, vendix-prisma-scopes, vendix-error-handling]
---
# B.2 — Cerrar todas las rutas de reserva y checkout

- **Skills:** vendix-backend, vendix-ecommerce-checkout, vendix-prisma-scopes, vendix-error-handling
- **Resources:** npx jest reservations checkout orders --runInBand; curl en paralelo
- **Business decision:** Ningún hold, confirmación por token, reprogramación, borrado, POS o checkout confirma una venta con estación/proveedor en conflicto.
- **Why:** Doble reserva o orden pagada sin recurso.
- **Output:** Coordinador transaccional común; secuencia de reserva/orden/pago con idempotencia y compensación de pago externo, sin capturar éxito parcial.
- **Contracts touched:** FB-07, FB-08, FB-09, FB-10, FB-11, FB-12, FB-27, FB-28, FB-29, FB-30, FB-31, FB-32, FB-33, FB-34, FB-35, FB-36, FB-37, FB-38, FB-39, FB-40, FB-41, FB-44, FB-45, FB-46, DB-06, DB-07, DB-20, DB-16, ERR-02, ERR-03, ERR-15, ERR-17, ERR-18, ERR-20, ERR-21
- **Data impact:** Crea/cambia/cancela asignaciones y cita en transacción.
- **Blast radius:** Doble reserva o orden pagada sin recurso.
- **Rollback:** Ocultar UI nueva, mantener guard de asignación hasta drenar sesiones y reconciliar órdenes/reservas.
- **Verification:**
  - `npx jest reservations checkout orders --runInBand`
- **Acceptance checklist:**
  - [x] Dos solicitudes concurrentes producen una 201 y una 409 → evidence/d1-database-exclusion-validation-20261014.md
  - [x] Hold guarda expires_at y worker/reclaim bajo lock libera recurso
  - [x] Cancelación/no-show/borrado/reagenda liberan intervalo viejo
  - [x] Checkout no absorbe error de reserva ni autoriza pago antes de cupo firme → evidence/f016-checkout-reconciliation-alert.md
  - [x] Flags skip_availability_check/skip_order_creation no eluden exclusión DB → evidence/d1-database-exclusion-validation-20261014.md
  - [x] DTO admin, ecommerce y checkout validan station_id según requires_station, tienda y variante
  - [x] Confirmación por token retorna 409 si ya se ocupó el recurso
  - [x] SQL 23P01/FK/hold vencido se traduce a error tipado, nunca 500
  - [x] F-002 — Checkout puede cobrar sin reserva (blocker) → evidence/design-audit.md
  - [x] F-004 — Confirmación pública tolera conflicto (blocker) → evidence/design-audit.md
  - [x] F-005 — Borrado de cita deja asignación (blocker) → evidence/design-audit.md
  - [x] F-006 — Hold vencido sigue bloqueando intervalo (major) → evidence/design-audit.md
  - [x] F-012 — Flags de bypass y SQL de exclusión sin tipar (major) → evidence/design-audit.md
  - [x] F-016 — Checkout deja orden, pago y reserva tras fallo de stock (major) → evidence/f016-checkout-reconciliation-alert.md
- **Status:** done · 2026-10-14

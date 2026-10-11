---
id: B.2
title: "Previsualizar elegibilidad de completar todas"
phase: B
status: done
owner: none
updated: 2026-10-06
contracts: [FB-11, FB-13, FB-14, DB-01, DB-04, DB-05, DB-07, ERR-07, ERR-08, ERR-10]
adrs: [ADR-03]
skills: [vendix-bulk-operations, vendix-backend, vendix-inventory-stock, vendix-error-handling]
---
# B.2 — Previsualizar elegibilidad de completar todas

- **Skills:** vendix-bulk-operations, vendix-backend, vendix-inventory-stock, vendix-error-handling
- **Resources:** bash evidence/verify-fb.sh FB-11; npx jest orders-bulk --runInBand
- **Business decision:** Solo se preseleccionan órdenes de esa sesión con saldo cero, cocina y entrega/stock listos; preview señala efecto exacto y versión.
- **Why:** Preview general actual puede advertir y aun permitir transición forzada.
- **Output:** Preview restringido de caja en `POST /store/orders/bulk/cash-session-preview` con razones por fila, máximo fijado, fingerprint y elegibles explícitos. La integración vive en `OrdersBulkController` para evitar una dependencia circular (`OrdersModule` ya importa `CashRegistersModule`).
- **Contracts touched:** FB-11, FB-13, FB-14, DB-01, DB-04, DB-05, DB-07, ERR-07, ERR-08, ERR-10
- **Data impact:** Sólo lectura de órdenes y efectos potenciales.
- **Blast radius:** Preview general actual puede advertir y aun permitir transición forzada.
- **Rollback:** Quitar acción de caja; mantener bulk general sin usarlo en cierre.
- **Verification:**
  - `bash evidence/verify-fb.sh FB-11`
- **Acceptance checklist:**
  - [x] Cancelled/refunded/delivered no se incluyen por fuerza
  - [x] Saldo, cocina, inventario y entrega se verifican
  - [x] El preview muestra estado inicial, destino, efectos y motivo de exclusión
  - [x] Selección rechaza IDs de otra caja o tienda
  - [x] Móvil y web reciben el mismo contrato
- **Status:** done

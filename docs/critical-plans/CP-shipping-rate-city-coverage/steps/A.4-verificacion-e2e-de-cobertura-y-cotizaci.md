---
id: A.4
title: "Verificación E2E de cobertura y cotización multi-tarifa"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [FB-01, FB-02, FB-03, FB-04, DB-01, DB-02, DB-03, DB-04, ERR-01, ERR-02, ERR-03]
adrs: [ADR-01, ADR-02]
skills: [vendix-backend-api, vendix-ecommerce-checkout]
---
# A.4 — Verificación E2E de cobertura y cotización multi-tarifa

- **Skills:** vendix-backend-api, vendix-ecommerce-checkout
- **Resources:** API de shipping y frontend checkout en `http://localhost:3000` / `http://localhost:4200`
- **Business decision:** Validar mediante pruebas E2E y peticiones HTTP completas la matriz de escenarios: 1) Tienda con solo tarifa nacional, 2) Tienda que crea tarifa en su ciudad propia, 3) Checkout mostrando tarifas local y nacional sin mensaje falso de falta de cobertura.
- **Why:** Certifica de forma irrefutable que el problema reportado por el usuario ("cree una nueva tarifa en mi ciudad y me sale No hay cobertura...") queda completamente resuelto.
- **Output:** Evidencias de verificación guardadas en `evidence/escenario-riohacha.md`.
- **Contracts touched:** FB-01, FB-02, FB-03, FB-04, DB-01, DB-02, DB-03, DB-04, ERR-01, ERR-02, ERR-03.
- **Data impact:** none — pruebas idempotentes en entorno de desarrollo.
- **Blast radius:** Flujo de compra completo en ecommerce storefront.
- **Rollback:** n/a — paso de verificación de solo lectura y validación.
- **Verification:**
  - `curl -s -X POST "http://localhost:3000/shipping/calculate?store_id=10" ...` verificando entrega local y carrier.
- **Acceptance checklist:**
  - [x] Verificar cotización para dirección en la ciudad configurada con tarifa local
  - [x] Verificar que no se suprima el método nacional cuando exista tarifa en la ciudad
  - [x] Verificar que checkout en storefront permita seleccionar la opción de envío y avanzar de paso
- **Status:** done

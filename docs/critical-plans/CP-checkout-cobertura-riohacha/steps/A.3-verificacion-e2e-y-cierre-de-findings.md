---
id: A.3
title: "Verificación E2E y cierre de findings"
phase: A
status: pending
owner: none
updated: 2026-09-08
contracts: [FB-01, FB-02, FB-04, ERR-01]
adrs: []
skills: [vendix-ecommerce-checkout, vendix-zoneless-signals, buildcheck-dev]
---
# A.3 — Verificación E2E y cierre de findings

- **Skills:** vendix-ecommerce-checkout, vendix-zoneless-signals, buildcheck-dev
- **Resources:** Playwright MCP (`--ignore-https-errors`) sobre `https://roku-shop.vendix.com/checkout` + `curl` FB-01 con el payload anotado + `npm run zoneless:audit --prefix apps/frontend`
- **Business decision:** con varias tarifas para la misma ciudad se listan todas y se exige elección; con una se autocontinúa; sin ninguna se explica con salida (recoger/otra dirección).
- **Why:** cierra el plan porque valida en prod lo que A.1 diagnosticó y A.2 desplegó; sin este paso los findings no pueden cerrarse.
- **Output:** matriz 1-tarifa/2-tarifas/solo-pickup verificada + findings cerrados con evidencia o decisión humana registrada.
- **Contracts touched:** FB-01 (cotización), FB-02 (métodos por envío), FB-04 (checkout final), ERR-01 (mensajes).
- **Data impact:** none — compras de prueba en tienda de test o con rollback de órdenes de prueba.
- **Blast radius:** nulo (lectura y compras de prueba controladas).
- **Rollback:** n/a (paso de verificación).
- **Verification:**
  - Domicilio Riohacha lista las 2 tarifas gratis y Continuar sin elegir avisa; con 1 tarifa avanza; pickup intacto
  - `zoneless-audit` sin regresiones nuevas; evidencias en `evidence/`
- **Acceptance checklist:**
  - [x] Matriz E2E en verde con evidencia en `evidence/e2e-matriz.md`
  - [ ] Todos los findings cerrados (fix + evidencia) o aceptados por humano
  - [ ] F-006 — guardar direccion falla 400 por municipality_code (major)
- **Status:** pending

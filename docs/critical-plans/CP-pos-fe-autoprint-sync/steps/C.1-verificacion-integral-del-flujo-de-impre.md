---
id: C.1
title: "Verificación integral del flujo de impresión fiscal"
phase: C
status: done
owner: rzy
updated: 2026-09-10
contracts: [FB-01, FB-02, FB-03, DB-01, DB-02, DB-03, ERR-01, ERR-02, ERR-03]
adrs: [ADR-01, ADR-02, ADR-03]
skills: [vendix-frontend, vendix-zoneless-signals]
---
# C.1 — Verificación integral del flujo de impresión fiscal

- **Skills:** vendix-frontend, vendix-zoneless-signals
- **Resources:** apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.spec.ts
- **Business decision:** Comprobar mediante pruebas unitarias exhaustivas y verificación manual que todos los caminos (éxito FE, fallo DIAN, timeout de 10s y venta sin FE) se comportan exactamente como se diseñó.
- **Why:** La emisión fiscal y la impresión en POS no admiten margen de error: un fallo en producción detiene las ventas de la caja o entrega documentos incorrectos al cliente.
- **Output:** Suite de pruebas unitarias que cubre los 4 escenarios de auto-impresión y reporte de verificación.
- **Contracts touched:** FB-01, FB-02, FB-03, DB-01, DB-02, DB-03, ERR-01, ERR-02, ERR-03
- **Data impact:** none — Ejecución de pruebas y verificación en entorno de desarrollo.
- **Blast radius:** Validación integral sin impacto en datos persistidos.
- **Rollback:** `git checkout HEAD -- apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.spec.ts`
- **Verification:**
  - `npm run test -- apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.spec.ts`
- **Acceptance checklist:**
  - [x] Test unitario: Venta sin FE dispara auto-impresión inmediata de ticket
  - [x] Test unitario: Venta con FE encola auto-impresión hasta recibir `issued`
  - [x] Test unitario: Venta con FE que recibe `issued` imprime FE con CUFE
  - [x] Test unitario: Venta con FE que falla imprime ticket contingencia y notifica
  - [x] Test unitario: Venta con FE que expira 10s imprime ticket contingencia y notifica
  - [x] Test unitario: Nueva venta cancela timers y previene impresiones huérfanas
- **Status:** done

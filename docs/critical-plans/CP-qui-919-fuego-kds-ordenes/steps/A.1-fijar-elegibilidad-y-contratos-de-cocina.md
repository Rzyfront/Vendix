---
id: A.1
title: "fijar elegibilidad y contratos de cocina"
phase: A
status: done
owner: orquestador
updated: 2026-10-06
contracts: [FB-01, FB-02, FB-03, FB-04, DB-01, DB-02, DB-03, DB-04, DB-05, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07, ERR-08, ERR-09, ERR-10]
adrs: [ADR-01, ADR-02, ADR-03]
skills: [vendix-restaurant-ops, vendix-panel-ui, vendix-permissions, vendix-frontend, vendix-backend, how-to-test]
---
# A.1 — fijar elegibilidad y contratos de cocina

- **Skills:** vendix-restaurant-ops, vendix-panel-ui, vendix-permissions, vendix-frontend, vendix-backend, how-to-test
- **Resources:** `rg -n "pendingKitchenItems|kitchenStateForItem|store:kitchen_fire:create" apps/frontend/src/app/private/modules/store/orders apps/backend/src/domains/store/kitchen-fire`; Linear QUI-919
- **Business decision:** La elegibilidad debe coincidir con el detalle y la visibilidad efectiva de KDS; fire se autoriza en backend.
- **Why:** Sin matriz cerrada, un ejecutor podría disparar platos `skip_kds` o pintar en tienda no restaurante.
- **Output:** `evidence/a1-contracts.md`: fixture, matriz de estados, permisos, módulo y payload SSE; corregir Knowledge Gaps si cambia.
- **Contracts touched:** FB-01, FB-02, FB-03, FB-04, DB-01, DB-02, DB-03, DB-04, DB-05, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07, ERR-08, ERR-09, ERR-10
- **Data impact:** none — lectura y observación en dev.
- **Blast radius:** Gate falso expone acción prohibida o esconde pedidos preparados.
- **Rollback:** Corregir plan antes de ejecutar B.1; sin código.
- **Verification:**
  - `curl` autenticado en dev: GET lista/detalle con orden mixta y comparar ids/estados actuales.
  - Inspeccionar selector de panel_ui y permiso real; registrar dos tiendas de prueba.
- **Acceptance checklist:**
  - [x] Distinguir `product_type=prepared` de `skip_kds`, cancelada y ya disparada.
  - [x] Fijar denominador por `quantity`, tickets activos/terminales y estados físico/virtual.
  - [x] Confirmar que el SSE de órdenes recibe `ticket.*` con `ticket.order_id`.
  - [x] Identificar selector efectivo de `restaurant_ops_kds`; registrar caída si no existe.
  - [x] F-004 — Error de DTO fire era 400 (major)
- **Status:** done · orquestador · 2026-10-06

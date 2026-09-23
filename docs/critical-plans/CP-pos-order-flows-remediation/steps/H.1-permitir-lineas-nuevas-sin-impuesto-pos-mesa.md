---
id: H.1
title: "Permitir líneas nuevas sin impuesto al cobrar desde POS mesa"
phase: H
status: pending
owner: none
updated: 2026-09-22
contracts: [FB-03, FB-66, FB-67, DB-13, DB-43, ERR-01, ERR-02]
adrs: [ADR-10]
skills: [vendix-backend, vendix-tax-typing, vendix-error-handling, how-to-test]
---
# H.1 — Permitir líneas nuevas sin impuesto al cobrar desde POS mesa

- **Skills:** `vendix-backend` (seam de cobro y transacción) · `vendix-tax-typing` (conservar cada tasa de catálogo cuando existe) · `vendix-error-handling` (retirar el falso 422 sin ocultar otros errores) · `how-to-test` (happy/sad/brute-force de ambos payloads).
- **Resources:** `apps/backend/src/domains/store/payments/payments.service.ts` (`createOrUpdateOrderFromPos` → `applyPosPaymentToTableSession` → `buildPosOrderItem`, `newItems` frente a `existingItems`) · `apps/backend/src/domains/store/taxes/taxes.service.ts` (`has_tax_assignment`) · `apps/backend/src/domains/store/payments/payments.service.spec.ts` · `apps/frontend/src/app/private/modules/store/pos/services/pos-payment.service.ts` · `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/tables.service.ts` · `ADR-10` · `curl -sS -D evidence/H1-pos-mesa-nueva.headers -o evidence/H1-pos-mesa-nueva.json -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @evidence/H1-pos-mesa-nueva.request.json "$API/store/payments/pos"`.
- **Business decision:** según ADR-10, un producto nuevo sin impuesto es vendible con o sin mesa, nueva o preexistente; no exige categoría 0 % ni área fiscal activa. Una línea gravada ya guardada conserva su snapshot; la ausencia de asignación actual no prueba pérdida fiscal.
- **Why:** POS «Consumir en mesa» envía `items` en el POST de cobro y Mesas no. El único `isTableSessionLine=true` se aplica a los ítems **recién llegados**; el gate actual rechaza precisamente los nuevos sin impuesto y no mira los viejos. Acotarlo por edad de sesión dejaría el mismo falso 422 en una mesa preexistente.
- **Output:** `buildPosOrderItem` usa el resolver tributario existente para construir líneas nuevas con cero cuando no hay asignación, y con tasas/desglose cuando sí la hay; elimina el rechazo basado solo en `isTableSessionLine && has_tax_assignment === false`. `applyPosPaymentToTableSession` conserva `existingItems` y sus `order_item_taxes` sin reinterpretarlos. No se toca el cálculo de venta POS sin mesa ni el endpoint de Mesas.
- **Contracts touched:** FB-03, FB-66, FB-67, DB-13, DB-43, ERR-01, ERR-02
- **Data impact:** no hay migración ni backfill. Los cobros legítimos que hoy revierten podrán persistir una línea nueva con `tax_amount_item=0` y sin filas `order_item_taxes`; eso no se etiqueta como daño fiscal. Las líneas históricas no se reescriben.
- **Blast radius:** POS «Consumir en mesa» para toda tienda, con o sin módulo fiscal. Un cambio mal hecho puede cobrar un impuesto incorrecto o duplicar líneas; el resultado debe conservar el total, la distribución por tasa y la idempotencia del cobro.
- **Rollback:** revertir únicamente H.1 restaura el falso 422; no modifica cobros ya confirmados. No sustituirlo por `tax_line_gate=warn/off` permanente.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/payments/payments.service.spec.ts` con casos de **mesa nueva y mesa preexistente**, cada una con línea nueva sin asignación: ambas cobran con impuesto 0 y sin `POS_TABLE_LINE_TAX_UNRESOLVABLE_001`; venta sin mesa conserva el resultado.
  - Mismo spec: categoría 0 % viva, IVA/INC positivo y carrito mixto conservan `order_item_taxes` por tasa y `grand_total`; mock de sesión antigua con línea ya gravada conserva su `tax_rate_id`, tipo y monto aunque el catálogo actual no tenga asignación.
  - `curl` con payloads guardados `evidence/H1-pos-mesa-nueva.request.json` y `evidence/H1-pos-mesa-existente.request.json` a `$API/store/payments/pos`: ambos 2xx, orden y pago únicos, ninguna respuesta contiene el código de ERR-01. Guardar cuerpos y headers en `evidence/`.
  - `docker logs --tail 120 vendix_backend` después de los dos cobros: sin excepción ni error de transacción; comparar contra la hora de recompilación, no un `dist` viejo.
- **Acceptance checklist:**
  - [ ] POS → «Consumir en mesa» cobra una línea nueva sin impuesto con `table_id`, aun si abre la sesión en esa petición.
  - [ ] POS cobra esa misma línea nueva sin impuesto con `table_session_id` de una mesa preexistente; no depende de `opened_at`.
  - [ ] POS sin mesa y módulo Mesas mantienen su conducta; no se exige categoría explícita de 0 %.
  - [ ] Tasas positivas, categoría 0 % y carrito mixto conservan precios y snapshots fiscales correctos.
  - [ ] Líneas antiguas gravadas no se recalculan a cero aunque cambie el catálogo.
  - [ ] `POS_TABLE_LINE_TAX_UNRESOLVABLE_001` no se lanza por ausencia de asignación actual en una línea nueva.
  - [ ] Evidencia de Jest, curl, SQL de orden/pago y logs vinculada bajo `evidence/`.
- **Status:** pending

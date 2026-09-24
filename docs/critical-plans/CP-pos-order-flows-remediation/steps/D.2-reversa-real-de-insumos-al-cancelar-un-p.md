---
id: D.2
title: "Reversa real de insumos al cancelar un plato preparado"
phase: D
status: pending
owner: none
updated: 2026-09-20
contracts: [FB-27, FB-28, DB-28, DB-29, DB-30, DB-31, DB-32, DB-44, DB-11]
adrs: [ADR-08, ADR-02]
skills: [vendix-restaurant-ops, vendix-inventory-stock, vendix-auto-entries, vendix-accounting-rules, vendix-inventory-valuation]
---
# D.2 — Reversa real de insumos al cancelar un plato preparado

- **Skills:** `vendix-restaurant-ops` (plato preparado, BOM, consumo al disparar) · `vendix-inventory-stock` (reversa, no doble ajuste) · `vendix-inventory-valuation` (costo consumido) · `vendix-auto-entries` (asiento idempotente de reclasificación) · `vendix-accounting-rules` (DR 5295 / CR 6135 cuadrado). Depende de **D.1**: probar la reversa antes de reutilizarla.
- **Resources:** ADR-08 · ADR-02 (el bloqueo por orden cobrada es precondición de fase A; este paso no lo relaja) · `apps/backend/.../order-flow/order-flow.service.ts:2409-2431` (restock del **producto vendido** en `cancelDeliveredOrderItem`) · `:2156-2200` (rama de reversa de `cancelOrderItem`, inalcanzable en la práctica) · `:3199-3248` (rama `reuse` de `cancelOrder`, la reversa correcta) · `apps/backend/prisma/schema.prisma:1386-1415` (contrato de `cancelled_at` / `cancellation_type`) · `apps/backend/.../accounting/account-mappings/account-mapping.service.ts:278-282` (`inventory.adjusted.shrinkage` → PUC 5295, `inventory` → 1435) · `.../auto-entries/auto-entry.service.ts:4529-4590` (`onInventoryAdjusted`, asiento por signo) · `.../auto-entries/accounting-events.listener.ts:985-1012` (`@OnEvent('inventory.adjusted')`) · `.../inventory/adjustments/inventory-adjustments.service.ts:396-418` (`emitInventoryAdjusted`, compuerta `cost_amount > 0`).
- **Business decision:** ADR-08, corregida y aprobada por el dueño el 2026-09-23: «reusar» revierte **las hojas del BOM**, nunca el producto vendido; «desechar» no mueve inventario y reclasifica el costo ya cargado al disparar cocina: **DR 5295 / CR 6135**. Nunca llamar al seam `inventory_adjusted.shrinkage` para esta merma: haría otro CR 1435 y doble descuento de stock. Ambos destinos excluyen la línea del cobro; «desechar» es el valor por defecto seguro.
- **Why:** `cancelDeliveredOrderItem` con `restock` devuelve el **producto vendido** (`:2409-2431`), no las hojas consumidas al disparar: infla el plato y pierde insumos. La rama de reversa por ítem sin entregar exige `before_fire && wasFired`, combinación inalcanzable; la reversa correcta vive solo en cancelación de orden completa. «Desechar» no postea nada hoy. El ajuste de inventario inicialmente propuesto sería peor: cocina ya descontó hojas y contabilizó DR 6135 / CR 1435; shrinkage restaría otra vez las hojas y acreditaría 1435. Por tanto se reclasifica solo el costo registrado, con idempotencia por línea y auditoría incluso si el costo es cero/desconocido. DB-31 debe conciliar su `source_type` contra el emisor real.
- **Output:** los dos seams de cancelación por línea dejan de devolver el producto vendido cuando es `prepared` y portan la reversa de hojas del BOM probada en D.1; «desechar» sobre línea consumida produce asiento idempotente DR 5295 / CR 6135 por el costo originalmente consumido, sin nuevo movimiento de stock; la auditoría registra destino, unidades, costo y hojas devueltas o castigadas, con costo desconocido explícito.
- **Contracts touched:** FB-27 (`cancel-delivered`: `restock` revierte BOM), FB-28 (mismo desde mesa), DB-28 (`stock_levels` del plato preparado no cambia), DB-29 (ningún restock de producto `prepared`), DB-30 (suma por hoja cero tras reusar), DB-31 (asiento de merma cuadrado), DB-32 (**DR 5295 / CR 6135**, corrige contrato anterior), DB-44 (auditoría con usuario, motivo y destino).
- **Data impact:** **escribe dinero e inventario.** Reuso devuelve cada hoja en `inventory_transactions`, `inventory_movements` y `stock_levels`. Desecho con costo conocido escribe un asiento y sus líneas, **sin** `inventory_adjustments` ni nuevo stock move. Siempre: cancelación de `order_items`, recálculo y auditoría. La implementación debe resolver mapping/idempotencia y declarar si requiere migración antes de desplegar; no asumir que la llave de shrinkage sirve. Snapshot predespliegue en `evidence/`.
- **Blast radius:** inventario de insumos, costeo, margen bruto del periodo y libro contable. Si la reversa devuelve cantidades equivocadas, el stock de las hojas queda inflado o hundido y el COGS del periodo miente; si el ajuste de merma se emite dos veces, el asiento se duplica. Quien lo nota: compras (faltantes que no cuadran) y el contador (margen inflado o cuenta 5295 con movimientos duplicados). Señales: `stock_levels` de un plato `prepared` que cambia tras una cancelación; movimientos de restock sobre productos `prepared`; asientos de merma con débito distinto del crédito.
- **Rollback:** **el daño no es reversible en frío.** Revertir el código detiene el sangrado pero no deshace lo ya escrito: los movimientos de inventario y los asientos emitidos quedan, y se corrigen con un ajuste manual y una nota contable, no con un `git revert`. Por eso el orden importa: D.1 primero, despliegue con «desechar» como destino por defecto, y el conteo de invariantes corriendo antes y después. Decide el contador (ADR-08).
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` — incluye los casos de D.1 más los nuevos por línea.
  - `npx jest --runInBand apps/backend/src/domains/store/accounting/auto-entries` — el asiento por signo sigue cuadrando.
  - `curl -s -X POST "$API/store/orders/$OID/flow/items/$IID/cancel-delivered" -H "Authorization: Bearer $TOKEN" -d '{"reason":"cayo una mosca","destination":"restock"}' -o evidence/D.2-reuso.json -w '%{http_code}\n'`
  - `psql "$DB" -c "SELECT product_id, SUM(quantity_change) FROM inventory_transactions WHERE order_item_id=$IID GROUP BY 1" > evidence/D.2-suma-por-hoja.txt` → 0 por hoja.
  - `psql "$DB" -c "SELECT quantity_on_hand FROM stock_levels WHERE product_id=$PLATO_PREPARADO" > evidence/D.2-plato-sin-cambio.txt` — idéntico antes y después.
  - `psql "$DB" -c "SELECT m.id FROM inventory_movements m JOIN products p ON p.id=m.product_id WHERE m.source_module='order_item_cancel_delivered' AND p.product_type='prepared'" > evidence/D.2-sin-restock-de-plato.txt` → 0 filas.
  - `curl -s -X POST "$API/store/orders/$OID2/flow/items/$IID2/cancel-delivered" -H "Authorization: Bearer $TOKEN" -d '{"reason":"se cayo al piso","destination":"waste"}' -o evidence/D.2-merma.json -w '%{http_code}\n'`
  - `psql "$DB" -c "SELECT c.code, l.debit_amount, l.credit_amount FROM accounting_entry_lines l JOIN chart_of_accounts c ON c.id=l.account_id WHERE l.entry_id=$ENTRY" > evidence/D.2-asiento-5295.txt` → DR 5295 / CR 6135, cuadrado; cero ajuste adicional de stock.
- **Acceptance checklist:**
  - [ ] Cancelar un plato preparado con reuso devuelve sus hojas del BOM y deja la suma por hoja en cero.
  - [ ] Cancelar un plato preparado NO cambia el `quantity_on_hand` del plato vendido, con ningún destino.
  - [ ] Ningún movimiento de restock de cancelación apunta a un producto de tipo preparado.
  - [ ] Cancelar con desecho no mueve stock y produce un asiento DR 5295 / CR 6135 cuadrado, una sola vez.
  - [ ] Una hoja con costo resuelto en cero no produce asiento, y su baja queda registrada en la auditoría como costo desconocido.
  - [ ] El destino por defecto, cuando el cliente no lo envía, es desechar; nunca reusar.
  - [ ] El bloqueo por orden ya cobrada sigue disparando antes que cualquier escritura de inventario o contable.
  - [ ] Una segunda llamada sobre la misma línea es idempotente: no duplica devoluciones ni asientos.
  - [ ] Snapshot de producción tomado antes del despliegue y enlazado desde `evidence/D.2-*`.
- **Status:** pending

---
id: D.1
title: "Test de la reversa de BOM antes de reutilizarla"
phase: D
status: pending
owner: none
updated: 2026-09-20
contracts: [FB-24, DB-09, DB-11, DB-30]
adrs: [ADR-08]
skills: [vendix-restaurant-ops, vendix-inventory-stock, how-to-test, buildcheck-dev]
---
# D.1 — Test de la reversa de BOM antes de reutilizarla

- **Skills:** `vendix-restaurant-ops` (fire, consumo de hojas del BOM, `inventory_consumed_at_fire`) · `vendix-inventory-stock` (`StockLevelManager.updateStock`, `movement_type='return'`, ubicación por defecto) · `how-to-test` (diseño de caminos feliz / triste / fuerza bruta) · `buildcheck-dev` (correr jest sin agotar la memoria de la máquina).
- **Resources:** ADR-08 («el primer trabajo de la fase D es escribir el test de esa rama **antes** de reutilizarla: el plan no puede apoyarse en una red que no existe») · `apps/backend/.../order-flow/order-flow.service.ts:3199-3248` (rama `reuse` de `cancelOrder`: relee `inventory_transactions` con `quantity_change < 0` y devuelve cada consumo real) · `:3178-3193` (rama de ticket `pending`, que cancela sin preguntar destino) · `apps/backend/.../order-flow/dto/cancel-order.dto.ts` (`kitchenDisposition`) · `apps/backend/.../order-flow/order-flow.service.spec.ts` (arnés existente) · censo: `grep -rn "kitchenDisposition" apps/backend/src --include='*.spec.ts'` devuelve **0**.
- **Business decision:** ADR-08 decide que «reusar» revierte **las hojas del BOM**, nunca el producto vendido, reutilizando el seam que ya existe. Este paso no cambia ninguna regla de negocio: fija por escrito, en forma de test ejecutable, cuál es el comportamiento que D.2 tiene derecho a dar por supuesto. La regla probada es: por cada transacción de consumo del ítem (`quantity_change < 0`) se emite exactamente una devolución por el mismo valor absoluto, a la ubicación por defecto de ese producto o variante, con `movement_type='return'` y **sin** `order_item_id`.
- **Why:** la rama está escrita y parece correcta, pero no tiene una sola prueba: `kitchenDisposition` no aparece en ningún `.spec.ts` del repositorio. Apoyar D.2 en ella sería construir sobre una red que nadie verificó. Y el riesgo no es teórico: la reversa depende de tres detalles frágiles a la vez — que relea las transacciones del **ítem** y no las del ticket, que use `Math.abs` sobre un `quantity_change` negativo (un signo invertido duplicaría el stock en vez de devolverlo), y que resuelva la ubicación por producto **y variante** (resolverla solo por producto devolvería la hoja a la bodega equivocada). Además la rama de ticket `pending` cancela sin pedir destino y escribe `after_fire_waste` en duro: el test debe fijar esa asimetría para que D.3 no la borre por accidente al unificar el vocabulario.
- **Output:** un bloque de pruebas sobre `cancelOrder` que cubre: `kitchenDisposition: 'reuse'` con un plato preparado de varias hojas; `'waste'` sobre el mismo escenario (cero devoluciones); ausencia de `kitchenDisposition` con ticket avanzado (rechazo tipado); ticket `pending` (cancela sin preguntar, `after_fire_waste`); y una línea sin consumo registrado (cero devoluciones, sin excepción). Cada aserción fija cantidad, signo, producto/variante, `movement_type` y `source_module`. El test **falla** contra cualquier regresión del signo o del alcance.
- **Contracts touched:** FB-24 (`flow/cancel` y su `kitchenDisposition`), DB-30 (la suma de `quantity_change` por hoja vuelve a cero tras `reuse`), DB-09 (`cancellation_type` escrito por cada rama), DB-11 (`inventory_consumed_at_fire` nunca se re-dispara ni vuelve a `false`).
- **Data impact:** none — el paso solo añade pruebas. No escribe ninguna fila en ningún entorno: el arnés usa dobles del cliente Prisma y del `StockLevelManager`, sin base real. Sin migraciones.
- **Blast radius:** ninguno en producción; el efecto es sobre la suite de CI. El riesgo propio del paso es escribir un test **tautológico**: si se reemplaza `StockLevelManager` por un doble genérico tipado contra el propio servicio, la aserción se recalcula contra lo que se quiere probar y pasa siempre. Quien lo nota: nadie, hasta que D.2 rompa el inventario en verde. Señal de detección: un test que sigue pasando tras invertir a mano el signo de la devolución.
- **Rollback:** trivial. Borrar el archivo o el bloque de pruebas; no hay efecto fuera de CI.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts 2>&1 | tee evidence/D.1-jest.txt` — verde, y el resumen (no el log) confirma que los casos nuevos corrieron.
  - `grep -c "kitchenDisposition" apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` → ≥ 5 (hoy 0 en todo el repositorio).
  - Mutación de control: invertir a mano el signo de la devolución en el servicio, correr `npx jest --runInBand` y comprobar que el test **falla**; revertir la mutación y guardar ambas salidas en `evidence/D.1-mutacion/`.
  - Segunda mutación de control: resolver la ubicación ignorando la variante; el test debe fallar también.
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-cancellation-policy.util.spec.ts` — la derivación de «orden cobrada» sigue verde.
- **Acceptance checklist:**
  - [ ] Existe cobertura de `kitchenDisposition` en el spec de flujo de orden: `reuse`, `waste`, ausente, ticket pendiente y línea sin consumo.
  - [ ] El caso `reuse` afirma una devolución por cada transacción de consumo, con el valor absoluto exacto de cada una.
  - [ ] El caso `reuse` afirma producto **y** variante en la resolución de ubicación, no solo producto.
  - [ ] El caso `waste` afirma cero llamadas de devolución de stock.
  - [ ] El caso sin `kitchenDisposition` sobre ticket avanzado fija el `errorCode`, no solo el tipo de excepción.
  - [ ] El caso de ticket pendiente fija que se cancela sin destino y escribe el tipo de merma en duro.
  - [ ] Invertir el signo de la devolución en el servicio pone el test en rojo; la evidencia de la mutación queda guardada.
  - [ ] Ningún doble de prueba se tipa contra la función bajo prueba: la aserción no se recalcula sola.
- **Status:** pending

# Variantes de producto y costeo (QUI-727 C.4 / QUI-736)

> Documenta cómo afecta la **variante de un producto** al costeo de
> inventario y a la trazabilidad contable — y la invariante que
> separa lo que **sí** puede llevar variante de lo que **no**.
>
> Fuente de verdad verificada línea por línea antes de escribir este
> documento:
> - `apps/backend/src/domains/store/recipes/recipes.service.ts:339-359`
>   — invariante "un insumo es un producto simple" (ADR-1).
> - `apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts:547-565,690-707,722-727,742-747,812-818,2131-2138`
>   — propagación de variante al fire.
> - `apps/backend/prisma/schema.prisma:10400-10490` — `kitchen_ticket_items`
>   + `kitchen_ticket_item_exclusions`.
> - `apps/backend/src/domains/store/print-formats/providers/kitchen-ticket.provider.ts:121-135`.
> - `apps/backend/src/domains/store/print-formats/providers/pos-sale-ticket.provider.ts:190-201`.
> - `apps/backend/src/domains/store/print-formats/interfaces/standard-print-data.model.ts:25-48`.
> - `apps/backend/src/domains/store/orders/orders.service.ts:274-282,1942-1952`.
> - `apps/backend/src/domains/store/tables/table-sessions.service.ts:600,1131-1173`.
> - `apps/backend/src/domains/accounting/auto-entries/auto-entry.service.ts:3002-3173`
>   — asientos automáticos `dispatch_note.delivered.cogs` /
>   `inventory` (referencia, no se modifica aquí).
>
> ## 1. ADR-1 — invariante: el **yield** puede tener variantes, los **componentes del BOM no**
>
> El producto vendido (`yield`, el plato preparado) **sí** puede tener
> variantes (`Pollo`, `Pollo Picante`, `Pollo Sin Picante`). Cada
> presentación es una fila en `product_variants` y descuenta stock
> sobre su propia fila de `stock_levels` cuando se vende.
>
> El **componente del BOM** (`recipe_items.component_product_id`, el
> insumo que la receta consume) **nunca** tiene variantes. La receta
> trabaja sobre el producto **base**, no sobre sus presentaciones. La
> decisión está fechada y documentada en el código:
> `recipes.service.ts:339-359` (`RECIPE_COMPONENT_HAS_VARIANTS`)
> rechaza con `422` cualquier intento de usar como insumo un producto
> con variantes activas. Razón técnica: `recipe_items` no tiene
> columna de variante; si un insumo la tuviera, descontaría de la fila
> base de `stock_levels` (vacía) sin fallar.
>
> Consecuencias:
>
> - **`kitchen-fire.updateStock` sobre las hojas del BOM no pasa
>   `variant_id`** (`kitchen-fire.service.ts:690-707`). Por
>   construcción no podría: las hojas no tienen variante.
> - **`recipes.service.ts.explodeBom` opera sobre producto base.** El
>   `variant_id` se propaga **downstream**, en el fire y en la venta.
> - El `KitchenTicketItem` del KDS muestra variante del yield (lo que
>   cocina ve y prepara), nunca del componente (lo que cocina consume).
>
> ## 2. ADR-7 — la variante impresa viaja por `variant_attributes`
>
> El compositor de impresión (`print-layout-composer.service.ts:437-438`)
> ya sabe pintar `StandardPrintItem.variant_attributes` dentro de la
> sublínea de la que cuelga `section.show_variant_attributes`. **No**
> se introduce un campo nuevo en el modelo de impresión.
>
> La columna de BD se llama `variant_label` (snapshot inmutable —
> protege contra renames posteriores de la variante que reescribirían
> tickets históricos). Los providers la **mapean** a
> `StandardPrintItem.variant_attributes`:
>
> - `kitchen-ticket.provider.ts:121-135` — `variant_label` →
>   `variant_attributes` en el ticket de cocina.
> - `pos-sale-ticket.provider.ts:190-201` — idem en el recibo POS.
>
> Definir un campo `StandardPrintItem.variant_label` paralelo y no
> leerlo el compositor habría dejado la variante sin pintar aunque la
> columna estuviera poblada — exactamente el bug que QUI-736 quería
> cerrar.
>
> ## 3. Flujo punta a punta
>
> ### 3.1 Escritura upstream — los **tres** puntos que validan pertenencia
>
> `variant_id` viaja en `order_items.product_variant_id`. Tres puntos
> de escritura lo reciben; los **tres** deben validar que la variante
> pertenezca al producto de la línea (ERR-15, `PRODUCT_VARIANT_MISMATCH`,
> 422), si no, A.6/C.4 estamparían una variante ajena en el ticket y
> el descuento de inventario. Las **dos** capas (A.6 en fire-time +
> C.4 en los 3 puntos upstream) son **necesarias y no redundantes**:
> A.6 protege el camino de cocina; C.4 cubre además las ventas retail
> que **nunca** disparan un fire.
>
> 1. `apps/backend/src/domains/store/orders/orders.service.ts:274-282` —
>    crear línea de orden.
> 2. `apps/backend/src/domains/store/orders/orders.service.ts:1942-1952` —
>    edición desde el editor. El fix de la ronda 1 añadió
>    `products: { store_id }` — cierra el leak multi-tenant, **no** el
>    cruce producto↔variante.
> 3. `apps/backend/src/domains/store/tables/table-sessions.service.ts:600` —
>    `add-items` a mesa abierta. **Aquí la validación va ANTES del
>    loop**, no dentro: `:591-637` ya es un `for…await` sobre
>    `$transaction` abierto con `order_item_exclusions` dependiente del
>    id recién creado. **Fix:** un solo
>    `tx.product_variants.findMany({ where: { id: { in: variantIds } } })`
>    **antes** del bucle, validar en memoria (mismo patrón que
>    `orders.service.ts:1942-1952`).
>
> ### 3.2 Fire-time — A.6 propaga la variante al ticket de cocina
>
> `kitchen-fire.service.ts`:
>
> - `:547-551` y `:561-565` — declaración del tipo `firedItemSnapshots`
>   (4 campos, **sin** variante en la versión previa).
> - `:722-727` (preparedItems) y `:742-747` (recipeLessItems) — los
>   **dos** `push()` copian `orderItem.product_variant_id` y
>   `variant_attributes` además de los 4 originales.
> - `:812-818` — `.create()` mapea sobre `snaps`, no sobre los
>   `order_items` originales. **La variante llega al `.create()` porque
>   está en `snaps`.**
> - `:2131-2138` — `splitLinesForExclusions` preserva la variante al
>   partir una línea por exclusiones distintas. Ambos fragmentos
>   heredan el mismo `product_variant_id` y `variant_label`.
>
> Persistencia en BD: `kitchen_ticket_items.product_variant_id` (FK
> nullable, additive migration A.3) + `kitchen_ticket_items.variant_label`
> (snapshot inmutable del label legible, p. ej. "Picante"). El ticket
> histórico de un producto sin variantes sigue siendo idéntico al de
> hoy: ambas columnas `NULL`.
>
> ### 3.3 Costeo — DR 6135 / CR 1435 al fire, **no** al pago
>
> COGS del plato preparado se reconoce **al disparar a cocina**, no al
> cobrar. El costo consumido es `Σ(FIFO costs consumed)` sobre las
> **hojas del BOM** (que recordemos no tienen variante) en el momento
> en que `StockLevelManager.updateStock` procesa el `consumption`
> (signo negativo) contra `inventory_cost_layers`. Asiento automático
> `kitchen.fired.cogs` / `kitchen.fired.inventory` vía
> `AccountingEventsListener.onKitchenFired`. **No** se vuelve a
> reconocer al pago (`inventory_consumed_at_fire` en
> `order_items` evita la doble contabilización).
>
> La **variante del yield** no afecta el monto del COGS — `6135` se
> carga por el valor consumido de las hojas, que son las mismas
> independientemente de "Picante" o "No Picante". La variante viaja
> como **etiqueta legible** (`variant_label`), no como diferencia de
> precio. Esa es la regla que C.6 hace explícita (ADR-10 / "nada de
> dinero en cocina").
>
> ### 3.4 Impresión — providers mapean a `variant_attributes`
>
> Ver ADR-7 §2. La sublínea aparece bajo `.kds-card__name` con su
> propio `margin-left`, alineada como `.kds-card__notes` pero con
> `<span class="sr-only">Variante: </span>` antes del valor (lectores
> de pantalla anuncian "Variante: Picante", no "Pollo… Picante" como
> si fuera un segundo plato).
>
> En el rollo de impresión: `print-layout-composer.service.ts:438`
> emite `<small class="item-sub item-variants">…</small>`. La regla
> `.item-variants` debe definir tamaño y peso legibles (sin ella el
> `<small>` defaultea a ~83% del body ≈ 7,5pt, el mismo tamaño que la
> letra menuda DIAN).
>
> ## 4. Tests y regresiones
>
> - **Smoke**: producto "Pollo" con 2 variantes "Picante" / "No Picante";
>   receta con "Pollo" base; orden de "Pollo Picante" → fire → ticket
>   cocina "Pollo — Picante", inventario "Pollo Picante" baja,
>   inventario "Pollo" no se mueve.
> - **Regresión con exclusiones (QUI-655)**: una línea partida por
>   `splitLinesForExclusions` debe conservar la variante en **ambos**
>   fragmentos.
> - **Regresión sin variantes**: producto variant-less → columnas `NULL`,
>   ticket idéntico al de hoy, sin cambios visibles.
> - **Matriz 2×2×2**: `{con variante, sin variante} × {con exclusión,
>   sin exclusión} × {línea partida, línea entera}` en
>   `kitchen-fire.service.spec.ts`.
> - **ERR-07 / ERR-15**: ver `vendix-error-handling` para los códigos;
>   `curl POST /store/table-sessions/:id/items` con
>   `product_variant_id` de **otro** producto debe responder 422, no 201.
>
> ## 5. Lo que **no** se hace aquí
>
> - **No** se rompe `recipes.@@unique([product_id])` para tener recetas
>   por variante. Opción (1) del trade-off C.4 — rechazada por costo
>   de migración y re-explosión del BOM.
> - **No** se pasa `variant_id` a `updateStock` sobre hojas del BOM
>   (`kitchen-fire.service.ts:690-707`); sería imposible por la
>   invariante de §1.
> - **No** se introduce `StandardPrintItem.variant_label` paralelo a
>   `variant_attributes`. Mapeo en los providers, no extensión del
>   modelo.
> - **No** se persiste ningún campo monetario nuevo al KDS por la
>   variante (C.6 / ADR-10). La variante viaja con etiqueta, no con
>   diferencia de precio.
>
> ## 6. Referencias cruzadas
>
> - `apps/backend/src/domains/store/recipes/recipes.service.ts:339-359`
>   — invariante "componente sin variantes".
> - `apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts`
>   — fire con variante, `splitLinesForExclusions`.
> - `apps/backend/prisma/schema.prisma:10400-10490` — schema de
>   `kitchen_ticket_items` y `kitchen_ticket_item_exclusions`.
> - Skill `vendix-product-variants` — reglas transversales de
>   variante (read, POS, cart, reservas).
> - Skill `vendix-restaurant-ops` — `inventory_consumed_at_fire`,
>   COGS al fire.
> - Skill `vendix-inventory-valuation` — CPP/FIFO, capas de costo,
>   `StockLevelManager`.
> - Skill `vendix-error-handling` — `PRODUCT_VARIANT_MISMATCH`
>   (ERR-15), `RECIPE_COMPONENT_HAS_VARIANTS` (ERR-08),
>   `PRODUCT_VARIANT_REQUIRED` (ERR-07).

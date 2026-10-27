# Modelo, recetas, producción, menús y permisos

## Ejes de producto (columnas en `products`, no hay entidad "plato")

| Columna | Default | Significado |
| --- | --- | --- |
| `product_type` | `physical` | `prepared` = plato compuesto por receta |
| `is_sellable` | `true` | Visible en POS / carta / ecommerce |
| `is_ingredient` | `false` | Elegible como componente en `recipe_items` |
| `is_combo` | `false` | Combo/menú fijo (recipe items apuntan a vendibles) |
| `is_batch_produced` | `false` | Sub-receta producida en `production_orders` (stock propio) |
| `stock_unit` / `purchase_unit` / `purchase_to_stock_factor` | `null` | Regla de unidad entera |

Casos: harina (false/true), agua dual (true/true), camiseta retail (true/false), archivado (false/false). Los defaults preservan retail.

## Regla de unidad (MVP)

Cantidades de stock, capas de costo y movimientos son `Int`. Cada ingrediente se guarda en su unidad mínima entera (g, ml, unidad) y la receta usa cantidades enteras; `purchase_to_stock_factor` convierte en la compra. `waste_percent` (ítem y receta) y `yield_quantity`/`yield_unit` son decimales; la cantidad final consumida se redondea a entero. Riesgo residual: redondeo acumulado (usar mili-unidades). Migrar a `Decimal(18,4)` está diferido y exige `vendix-prisma-migrations`.

## Recetas / BOM

- `recipes` 1:1 con un producto `prepared` (`product_id` único por tienda); `recipe_items` con `component_product_id`, `quantity` entera y `waste_percent`.
- `RecipesService.explodeBom(recipeId, multipliers)` es el único recorrido de sub-recetas (fire y producción). No reimplementar.
- Anti-ciclo: un componente no puede ser el propio producto; DFS de ciclos transitivos al guardar.
- UI: `apps/frontend/src/app/private/modules/store/restaurant-ops/recipes/` (`app-multi-selector` con `is_ingredient=true`).
- Costeo por variante: `apps/backend/src/domains/store/recipes/README-variant-costing.md`.

## Producción de sub-recetas (`production-orders.service.ts complete()`, una transacción)

1. Por cada `recipe_item`: `StockLevelManager.updateStock` `movement_type='consumption'` negativo, con merma multiplicativa `(1 + line_waste/100) * (1 + recipe_waste/100)`.
2. `produced_qty = planned_qty * (1 - waste_percent/100) * yield_factor`.
3. `updateStock` `movement_type='production'` positivo con `unit_cost = Σ(costos FIFO consumidos) / produced_qty`.
4. Orden `completed`; emitir `production.completed` después del commit (si falla, no revierte).
Contabilidad: `production.completed.finished_goods` / `production.completed.ingredient_consumed` (DR 1435 / CR 1435).

## Menú / carta

- `menus` → `menu_sections` → `menu_section_items` (producto + orden).
- `menu_availability_windows`: `day_of_week` + `start_time`/`end_time` ("HH:mm") a nivel menú o sección; el filtro usa el mismo algoritmo `Intl.DateTimeFormat` de `schedule-validation.service.ts:getDateInTimezone` (no duplicar).
- Combo = `prepared` + `is_combo=true` con `recipe_items` a vendibles; precio propio (`vendix-product-pricing`); en fire se explota la receta.
- Ingeniería de menú BCG (`menu-engineering.service.ts`): popularidad × margen (precio − costo receta) → estrella / caballo / puzzle / perro. UI: `restaurant-ops/menus/pages/menu-engineering-page/`.
- Carta pública (`@Public()` en `catalog.service.ts`): filtra `is_sellable: true` y ventana activa. No quitar `@Public()`.

## Permisos (`permissions-roles.seed.ts`)

`store:recipes:create|read|update|delete`, `store:production_orders:create|read|update`, `store:kitchen_fire:create|read|update`, `store:tables:create|read|update|delete`, `store:table_sessions:create|read|update`, `store:menus:create|read|update|delete`, `store:menu_engineering:read`.

## Esquema y scopes

- `apps/backend/prisma/schema.prisma`; migraciones base `20260613000000_restaurant_suite_foundation` y `20260613000001_fire_to_kitchen_inventory_flag`.
- Modelos store-scoped en `apps/backend/src/prisma/services/store-prisma.service.ts`.

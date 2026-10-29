# Manufactura (MVP) — "un motor, dos pieles"

Módulo de manufactura de la tienda. **No duplica** el motor de inventario:
reutiliza `RecipesService` (fórmulas/BOM, explosión) y
`ProductionOrdersService.complete()` (consumo FIFO/CPP con merma + entrada del
terminado + evento `production.completed`). Lo propio de manufactura va encima.

Industria: visible solo cuando la tienda incluye `manufacturing`
(`restaurant` sigue usando `store/recipes` y `store/production-orders` sin cambios).

## Endpoints (`/api/store/manufacturing/...`)

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET / POST | `formulas` | `store:manufacturing:formulas:read` / `create` |
| GET / PATCH / DELETE | `formulas/:id` (DELETE = archivar: `is_active=false`, `status=archived`) | `read` / `update` / `delete` |
| PUT | `formulas/:id/items` (reemplaza componentes) | `formulas:update` |
| GET | `formulas/:id/cost` (costo teórico + desglose) | `formulas:read` |
| GET | `formulas/:id/explosion?quantity=N` (`RecipesService.explodeBom`) | `formulas:read` |
| GET / POST | `orders` | `orders:read` / `create` |
| GET / PATCH | `orders/:id` (PATCH solo `draft`/`released`) | `orders:read` / `update` |
| POST | `orders/:id/release` · `start` · `complete` · `cancel` | `orders:update` |
| GET | `orders/:id/shortages` | `orders:read` |
| GET / PATCH | `settings` (defaults si no hay fila) | `settings:read` / `update` |

`POST/PATCH formulas` aceptan además `items?: RecipeItemInputDto[]`.
`status` ∈ `draft|active|archived`; `is_active` se deriva (`active` ⇒ `true`).

## Modelo

- `recipes` (+ `code`, `version`, `status`): la fórmula.
- `production_orders` (+ `order_number`, `due_date`, `started_at`, `location_id`,
  `batch_id`, `priority`, `notes`, `created_by`, `source`, `planned_cost`,
  `actual_cost`, `unit_cost`). Solo las órdenes con `order_number` son de manufactura.
- `production_order_lines`: planificado vs consumido, costo unitario/total y
  `cost_snapshot` (historial de consumos) por componente.
- `manufacturing_settings`: bodegas por defecto, `cost_method` (`fifo|cpp`),
  `lot_required`, `wip_account_id`.
- `store_sequences`: consecutivo `production_order` → `OP-000001`
  (`INSERT … ON CONFLICT DO UPDATE … RETURNING`, dentro de la transacción de creación).

## Estados

`draft → released → in_progress → partially_completed → completed`, y
`cancelled` solo desde `draft | released | in_progress` (con producción parcial
ya hubo movimientos: se rechaza con `MFG_CANCEL_AFTER_PARTIAL`).
`complete` acepta `in_progress | partially_completed`; `produced_qty` por
defecto es lo pendiente y se acumula hasta alcanzar `planned_qty`.

## Cómo se reutiliza el motor

`ProductionOrdersService.complete(id, dto, options?)` recibe opciones
**opcionales** (`CompleteProductionOptions`); sin ellas el comportamiento del
restaurante no cambia (tandas enteras, `source_module='production'`):

- `allowPartialBatch`: omite `assertWholeBatches` (producción proporcional).
- `sourceModule`: `'manufacturing'` en los movimientos de inventario.
- `inputLocationId` / `outputLocationId` / `costingMethod`: bodegas y método de costeo.
- `onProduced(tx, info)`: hook dentro de la transacción; manufactura persiste
  líneas, lote (`lot_required`), `actual_cost`, `unit_cost` y el estado.
- `computeComponentRequirements(recipe, qty)`: misma cuenta que el consumo real
  (merma + escalado); la usan líneas planificadas y faltantes.

El evento `production.completed` mantiene su payload y, cuando hay opciones,
agrega `source_module` y `lines`.

## Extensión (F2/F3, fuera del MVP)

- WIP/cuenta puente (`wip_account_id` ya existe en settings).
- Costeo de mano de obra/CIF, rutas y centros de trabajo.
- Órdenes originadas en pedidos de venta (`source='order'`) y reservas de insumos.
- Versionado de fórmulas (hoy `version` es informativo).

Tests: `npx jest src/domains/store/manufacturing` (desde `apps/backend`).

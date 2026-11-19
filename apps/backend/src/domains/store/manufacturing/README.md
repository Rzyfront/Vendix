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
| GET | `plants` (`?include_inactive=true`) · `plants/:id` | `settings:read` **o** `orders:read` |
| POST / PATCH | `plants` · `plants/:id` (PATCH `is_active=false` = desactivar) | `settings:update` |
| GET | `plants/managers?search=` (equipo activo para «Responsable») | `settings:update` |
| GET | `orders/day` · `orders/day/supplies` (`?plant_id=` = sesión de una planta) | `orders:read` |

`POST/PATCH formulas` aceptan además `items?: RecipeItemInputDto[]`.
`POST/PATCH orders` aceptan `plant_id?`; `GET orders` acepta `?plant_id=`.
`status` ∈ `draft|active|archived`; `is_active` se deriva (`active` ⇒ `true`).

## Modelo

- `recipes` (+ `code`, `version`, `status`): la fórmula.
- `production_orders` (+ `order_number`, `due_date`, `started_at`, `location_id`,
  `batch_id`, `priority`, `notes`, `created_by`, `source`, `planned_cost`,
  `actual_cost`, `unit_cost`). Solo las órdenes con `order_number` son de manufactura.
- `production_order_lines`: planificado vs consumido, costo unitario/total y
  `cost_snapshot` (historial de consumos) por componente.
- `manufacturing_settings`: bodegas por defecto, `cost_method` (`fifo|cpp`),
  `lot_required`, `wip_account_id`. Con plantas, sus bodegas quedan solo como
  respaldo de las órdenes sin planta.
- `manufacturing_plants` (QUI-1013): `name` (único por tienda), `input_location_id`,
  `output_location_id`, `manager_user_id?`, `is_active`. Se desactivan, nunca se
  borran (bloqueado con órdenes abiertas: `MFG_PLANT_HAS_OPEN_ORDERS`). La
  **planta principal** es la activa de menor id (la que la migración
  `20261208090000_manufacturing_plants` creó desde la configuración anterior).
- `production_orders.plant_id` (nullable): NULL en órdenes del restaurante y en
  tiendas sin plantas (siguen con las bodegas de `manufacturing_settings`).
- `store_sequences`: consecutivo `production_order` → `OP-000001`
  (`INSERT … ON CONFLICT DO UPDATE … RETURNING`, dentro de la transacción de creación).

## Plantas (QUI-1013)

- **Asignación** (`ManufacturingPlantsService.resolveForOrder`): `plant_id` explícito
  (activa y de la tienda) → esa; sin `plant_id` y una sola planta activa → esa;
  sin plantas → NULL; varias → `MFG_PLANT_REQUIRED`. Editable en `draft|released`.
  Las órdenes nacidas de una venta (QUI-995) van a la planta principal.
- **Bodegas**: insumos = `planta.input ?? settings.default_input ?? bodega del insumo`;
  terminado = `dto.location_id ?? orden.location_id ?? planta.output ??
  settings.default_output ?? bodega del producto`. `ProductionOrdersService.complete`
  usa la planta de la orden como respaldo cuando quien llama no fija bodegas.
- **Faltantes/bloqueo**: con bodega de insumos resuelta, `shortages` y el
  pre-chequeo de `complete` (`consumeLocationId`) leen SOLO esa bodega (aunque sea
  central o no vendible), respetando «Permitir sobre-uso de insumos».
- **Sesión**: no hay tabla de sesiones; Producción activa / Lista del día de Planta
  quedan enlazadas a una planta con `?plant_id=` (el frontend pide elegirla si hay
  varias y la recuerda por tienda).

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
- Plantas fase 2 (QUI-1013): reportes por planta, permisos de usuario por planta,
  líneas de producción por planta, planta en el impreso del lote (QUI-1011).
- Costeo de mano de obra/CIF, rutas y centros de trabajo.
- Órdenes originadas en pedidos de venta (`source='order'`) y reservas de insumos.
- Versionado de fórmulas (hoy `version` es informativo).

Tests: `npx jest src/domains/store/manufacturing` (desde `apps/backend`).

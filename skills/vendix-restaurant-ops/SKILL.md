---
name: vendix-restaurant-ops
description: >
  Suite restaurante (lado POS/admin): recetas/BOM, productos prepared/insumos, fire-to-kitchen, KDS por SSE, mesas, cuenta abierta, menús. Trigger: recipes, BOM, kitchen fire, KDS, table sessions, bill split, menu engineering, tiendas `restaurant`.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.5"
  scope: [root]
  auto_invoke:
    - "Validating tracked ingredients before fire/resend/production consumption"
    - "Debugging a fire/resend/production block on insufficient tracked ingredient (INV_STOCK_INSUFFICIENT_LINES kind:'ingredient')"
    - "Editing recipes, BOM explosion, or sub-recipe production orders"
    - "Editing kitchen-fire, fire-to-kitchen, or kitchen tickets / KDS"
    - "Editing tables, table sessions, or order split logic"
    - "Editing menus, menu sections, menu availability windows, or menu engineering"
    - "Modifying the POS for restaurant flow (fire, open table, split bill)"
    - "Working with order_items.inventory_consumed_at_fire flag"
    - "Working with product_type_enum='prepared' or the is_sellable/is_ingredient/is_combo/is_batch_produced flags"
    - "Editing industry gating so that only `restaurant` stores see restaurant_ops"
    - "Adding or adjusting the POS stock-vs-KDS decision modal (skipKds) for prepared+track_inventory+stock>0 products"
    - "Adding or adjusting KDS card urgency tiers (warning / danger) driven by preparation_time_minutes"
    - "Wiring the KDS ticket detail modal (recipe + actions replica)"
    - "Modifying the POS payment close-out against an open table (table_session_id, applyPosPaymentToTableSession, table status cleaning)"
    - "Modifying the POS open-table flow that propagates an optional customer to the session and draft order"
---

## Alcance

Lado POS/admin de tiendas con `restaurant` en `stores.industries`: recetas/BOM, producción de sub-recetas, fire-to-kitchen, KDS, mesas/cuenta abierta, split, menús. El lado comensal (QR, `?mesa=`, storefront) es de `vendix-restaurant-table-qr`; no duplicarlo aquí.

Detalle bajo demanda:
- Modelo de producto, unidad entera, recetas, producción, menús, permisos: `references/domain-recipes-menus.md`.
- Mesas, cobro contra mesa, `skipKds`, split, cliente opcional: `references/pos-tables-flow.md`.
- KDS (SSE, urgencia, modal, modo físico/virtual, comanda impresa): `references/kds.md`.

## Código

- Backend: `apps/backend/src/domains/store/{recipes,production,kitchen-fire,kds,tables,menus}/`; auto-entries en `domains/store/accounting/auto-entries/`; validador en `domains/store/inventory/shared/services/stock-validator.service.ts`.
- Frontend: `apps/frontend/src/app/private/modules/store/restaurant-ops/{recipes,production,kds,tables,menus}/`; POS en `private/modules/store/pos/`.

## Invariantes (no romper)

1. **Plato = `products` con `product_type='prepared'`.** No crear entidad "plato". Combos = `prepared` + `is_combo=true`.
2. **Cantidades de inventario enteras** en la unidad mínima de stock; no migrar a `Decimal` en el MVP.
3. **`RecipesService.explodeBom` es el único recorrido de recetas** (fire y producción). Anti-ciclo con DFS al guardar.
4. **Inventario y COGS de `prepared` se consumen en fire, no en el pago.** `fireOrderItems`/`fireOrderItemsInTx` (`kitchen-fire.service.ts`) consume hojas del BOM, marca `order_items.inventory_consumed_at_fire = true`, crea `kitchen_ticket(_items)` y emite `kitchen.fired` tras commit (asiento `kitchen.fired.cogs` / `kitchen.fired.inventory`, DR 6135 / CR 1435, `AutoEntryService.onKitchenFired`).
5. **Anti-doble-descuento:** el consumo/reserva de la orden salta ítems con `inventory_consumed_at_fire === true` (`order-flow.service.ts`; buscar ese literal). No quitar ese guard al refactorizar pagos/órdenes. Re-fire del mismo ítem es no-op; error si todos se saltaron.
6. **Fire sin receta activa:** se permite, sin BOM ni movimiento (COGS 0) pero con flag = true. `startPreparation` rechaza el ticket completo con `KITCHEN_TICKET_NO_RECIPE` (422) si algún ítem no tiene receta; el operador adjunta receta o entrega directo. Significado del flag: "disparado a KDS, el pago no lo toca, COGS puede ser 0".
7. **No sobreventa de ingredientes:** antes de consumir, fire/resend/`production-orders complete()` llaman `StockValidatorService.assertIngredientsAvailable(demands, {tx})` sobre el BOM explotado SUMADO (ingrediente compartido se valida una vez); ingredientes no trackeados se saltan. Un `prepared` con `skipKds=false` se valida por ingredientes, nunca por su stock propio; con `skipKds=true` se valida como producto normal en el pago (`assertLinesAvailable`).
8. **`store_settings.inventory.allow_ingredient_overuse` default `true`** (faltante/null → true; nunca `?? false`). ON: no lanza, `logger.warn`, consume todo con `allow_negative: true, validate_availability: false` (stock negativo) y devuelve `stock_warnings` (toast `formatStockWarningSummary`, `apps/frontend/src/app/core/utils/stock-shortage.util.ts`). OFF: 409 `INV_STOCK_INSUFFICIENT_LINES` (`kind: 'ingredient'`, con `used_by`), nada consumido, ningún ticket llega al KDS. Contrato compartido: `vendix-inventory-stock`.
9. **Producción** en una transacción: consumo con merma multiplicativa, producción con `unit_cost = Σ FIFO / produced_qty`, `production.completed` tras commit (DR 1435 / CR 1435).
10. **Split es solo financiero:** propaga el flag; nunca crea movimientos de consumo.
11. **`skipKds`** (persistido en `order_items.skip_kds`): excluido del fire, sin flag, stock propio consumido en el pago como `sale`. Es parte de la clave de merge del carrito.
12. **Cobro contra mesa** (`applyPosPaymentToTableSession`): fire de pendientes en la misma transacción, `closed_at` y mesa → `cleaning`.
13. **Eventos SSE/dominio solo después del commit.**
14. **`kitchen_mode`** se lee solo con `resolveKitchenMode`/`normalizeKitchenMode`; default `virtual`. En físico no se relajan las compuertas de cierre.
15. **Gating inverso:** toda industria salvo `restaurant` lista `restaurant_ops` en `INDUSTRY_HIDDEN_MODULES` (`apps/frontend/src/app/shared/constants/industry-modules.constant.ts`); el cruce industria ∩ tienda ∩ usuario impide reactivarlo. No relajarlo.
16. Carta pública: mantener `@Public()` y el filtro `is_sellable: true` + ventana de disponibilidad.

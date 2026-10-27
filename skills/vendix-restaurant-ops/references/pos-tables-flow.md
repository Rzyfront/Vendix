# POS restaurante: mesas, cobro, skipKds, split

## Mesas y cuenta abierta

- `tables` (por tienda: `pos_x`, `pos_y`, `status`). `table_sessions` = cuenta abierta: abrir crea una orden `draft` (`orders.service.create`) enlazada por `order_id`; agregar ítems añade `order_items` (sin fire automático).
- Cerrar sesión marca `closed_at`; no finaliza la orden (la finaliza el pago).
- Split (`split-order.service.ts`: `splitOrderByItems`, `splitOrderByAmount`) es solo financiero: sub-órdenes propagan `inventory_consumed_at_fire=true`; nunca crea movimientos de consumo.

## Cliente opcional

- `orders.customer_id` es `Int?`; `create-order.dto` `@IsOptional() @IsInt() @Min(1)`; `orders.service.create` omite el lookup si es null. No existe "Cliente General / id=1": anónimo real.
- `OpenTableSessionDto.customer_id?`; `PosOpenTableModalComponent` `[customer]` lo propaga a sesión y orden draft.

## Decisión stock vs KDS (`skipKds` / `order_items.skip_kds`)

Producto `prepared` + `track_inventory` + stock > 0 → `pos-prepared-choice-modal` al agregar (solo `isRestaurantMode()`).
- `skipKds=false` (default, "Producir por KDS"): entra a fire; se consumen ingredientes; el stock propio no se toca.
- `skipKds=true` ("Usar stock"): excluido del fire, sin ticket, sin flag; se consume su stock en el pago como `sale`.
- Persistido en `order_items.skip_kds` (default false).
- Clave de merge del carrito (`pos-cart.service.processAddToCart`): `product.id + variant_id + skipKds`.
- Filtrar `skipKds` en: `hasUnfiredPreparedItems` (POS), `preparedItemIdsFromOrder` (modal de creación) y los loops de fire (`fireCounterOrder`, `fireKitchenFromCompletedOrder`, close-out de mesa).

## Crear orden y cobro contra mesa

- `PosOrderCreateModalComponent.onConfirm`: con sesión abierta gana SIEMPRE la rama de mesa (`appendToTableAndFire`, sin líneas `skipKds`); antes caía a `createRetailDraft` y dejaba la mesa huérfana.
- `PosPaymentInterfaceComponent`: en `consumo`, CTA "Abrir mesa" embebe `PosOpenTableModalComponent`; signals `pickedTableId`/`pickedSessionId`; `canProcessPayment` usa `tableId() ?? pickedTableId()`. `processSaleWithPayment(cart, payment, user, tableSessionId?)` manda `table_session_id`.
- Backend `PaymentsService.createOrUpdateOrderFromPos` con `table_session_id` → `applyPosPaymentToTableSession`: valida sesión de la tienda y abierta, agrega ítems nuevos, recalcula subtotal/impuestos/descuentos/total (re-cotiza promo + cupón), auto-dispara a cocina los `prepared` pendientes dentro de la misma transacción (`prepareFireContext` + `fireOrderItemsInTx`; `kitchen.fired` y SSE tras commit vía `emitKitchenFiredAfterCommit`), marca `closed_at` y la mesa `status='cleaning'` (si no, queda `occupied` y bloquea la siguiente apertura).

## Otros

- POS filtra `is_sellable=true`; salidas `openTable`, `fireKitchen`, `splitBill` en `pos-cart.component.ts` → `pos-restaurant-integration.service.ts`.
- Lista de órdenes recarga con `reloadTick` en `NavigationEnd` a `/admin/orders` (lazy `loadComponent`).

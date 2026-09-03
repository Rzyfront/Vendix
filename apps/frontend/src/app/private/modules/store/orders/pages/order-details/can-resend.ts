import { OrderItem, OrderState } from '../../interfaces/order.interface';

/**
 * Predicado que decide si un ítem de la orden es reenviable a cocina
 * (QUI-762). Espejo del lado backend en `KitchenFireService.resendOrderItems`:
 * si esta función devuelve `false`, el backend rechazaría con 422
 * `KITCHEN_FIRE_NOT_RESENDABLE`.
 *
 * Tres entradas booleanas (8 casos):
 *  - `item.inventory_consumed_at_fire` debe ser `true`.
 *  - `orderState` NO debe estar en `['cancelled', 'refunded']`.
 *  - ningún `kitchen_ticket_items` del item debe tener `status === 'delivered'`.
 *
 * Pura: no toca signals ni estado de componente. Exportada para que el
 * spec la pruebe sin instanciar `OrderDetailsPageComponent`.
 */
export function canResendOrderItem(
  item: Pick<OrderItem, 'inventory_consumed_at_fire' | 'kitchen_ticket_items'>,
  orderState: OrderState | string | null | undefined,
): boolean {
  if (!item.inventory_consumed_at_fire) return false;
  // Sin estado de orden no se puede afirmar que sea reenviable: el
  // componente llama a esto mientras `order()` aún es null y el botón
  // no debe ofrecerse durante la ventana de carga (esa es la guarda
  // que el componente original tenía y que la extracción tenía que
  // preservar). `null` y `undefined` llegan por `this.order()?.state`.
  if (orderState == null) return false;
  if (
    orderState === 'cancelled' ||
    orderState === 'refunded'
  ) {
    return false;
  }
  const items = item.kitchen_ticket_items ?? [];
  if (items.some((k) => k.status === 'delivered')) return false;
  return true;
}
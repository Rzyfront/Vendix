import { OrderItem, OrderState } from '../../interfaces/order.interface';

/**
 * Decisiones de cocina persistidas por ítem al cancelar una orden con
 * `kitchenDisposition` (`POST /store/orders/:id/flow/cancel`). Solo con una
 * de estas decisiones el resend acepta un remake post-cancelación.
 */
export type CancellationDecision = 'after_fire_reused' | 'after_fire_waste';

const POST_CANCEL_DECISIONS: ReadonlySet<string> = new Set([
  'after_fire_reused',
  'after_fire_waste',
]);

/** True cuando el ítem trae una decisión de cocina post-cancelación. */
export function hasCancellationDecision(
  item: Pick<OrderItem, 'cancellation_type'>,
): boolean {
  return (
    item.cancellation_type != null &&
    POST_CANCEL_DECISIONS.has(item.cancellation_type)
  );
}

/**
 * Predicado que decide si un ítem de la orden es reenviable a cocina
 * (QUI-762 + remake post-cancelación). Espejo del lado backend en
 * `KitchenFireService.resendOrderItems`:
 * si esta función devuelve `false`, el backend rechazaría con 422
 * `KITCHEN_FIRE_NOT_RESENDABLE`.
 *
 * Reglas:
 *  - `item.inventory_consumed_at_fire` debe ser `true` (sin excepción).
 *  - Sin estado de orden (`null`/`undefined`) no es reenviable: el
 *    componente llama a esto mientras `order()` aún es null y el botón
 *    no debe ofrecerse durante la ventana de carga.
 *  - `orderState === 'refunded'` veta siempre (ni la decisión lo levanta).
 *  - `orderState === 'cancelled'` veta SALVO decisión persistida
 *    (`after_fire_reused` | `after_fire_waste`): es el remake
 *    post-cancelación.
 *  - Un `kitchen_ticket_items` con `status === 'delivered'` veta SALVO
 *    decisión persistida (el remake de un plato entregado-cancelado
 *    vuelve a consumir o no según la decisión).
 *  - Una fila con `cancelled_at` (soft cancel por ítem o cancelación de
 *    la orden, que marca TODOS sus ítems disparados) veta SALVO decisión
 *    persistida: sin esta excepción el remake post-cancelación quedaría
 *    muerto en la UI aunque el backend lo acepte.
 *  - Sin decisión, el veto actual queda intacto.
 *
 * Pura: no toca signals ni estado de componente. Exportada para que el
 * spec la pruebe sin instanciar `OrderDetailsPageComponent`.
 */
export function canResendOrderItem(
  item: Pick<
    OrderItem,
    | 'inventory_consumed_at_fire'
    | 'kitchen_ticket_items'
    | 'cancellation_type'
    | 'cancelled_at'
  >,
  orderState: OrderState | string | null | undefined,
): boolean {
  if (!item.inventory_consumed_at_fire) return false;
  // Sin estado de orden no se puede afirmar que sea reenviable: el
  // componente llama a esto mientras `order()` aún es null y el botón
  // no debe ofrecerse durante la ventana de carga (esa es la guarda
  // que el componente original tenía y que la extracción tenía que
  // preservar). `null` y `undefined` llegan por `this.order()?.state`.
  if (orderState == null) return false;
  if (orderState === 'refunded') {
    return false;
  }
  const decided = hasCancellationDecision(item);
  if (item.cancelled_at != null && !decided) return false;
  if (orderState === 'cancelled') {
    // Remake post-cancelación: solo con decisión persistida.
    return decided;
  }
  const items = item.kitchen_ticket_items ?? [];
  if (!decided && items.some((k) => k.status === 'delivered')) return false;
  return true;
}

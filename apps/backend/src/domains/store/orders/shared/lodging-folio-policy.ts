import { ErrorCodes, VendixHttpException } from 'src/common/errors';

/**
 * The draft order of an open hotel folio (`lodging_folios.order_id`) is owned
 * by the hospitality services. Cancelling, promoting, paying or voiding lines
 * of it from the generic order flow would leave the folio "open" while
 * charges, payments and check-out fail, so the guest could not leave.
 * Once checked out the order is a normal sale (no `draft`): not blocked here.
 * Without `state` (a lean probe) the folio link alone blocks.
 */
export function assertNotLodgingFolioOrder(order: {
  state?: string | null;
  lodging_folio?: { id: number } | null;
}): void {
  if (!order.lodging_folio) return;
  if (order.state != null && order.state !== 'draft') return;
  throw new VendixHttpException(
    ErrorCodes.ORD_STATUS_001,
    'Esta orden es el folio de una reserva: gestiónala desde Hotelería',
  );
}

import { whatsappHref } from '../app-page/app-page-view.util';
import { buildOrderInquiryMessage } from '../../shared/utils/order-whatsapp-inquiry.util';

/** What Vexi needs to hand an order off to the store's real WhatsApp. */
export interface VexiHandoffOrder {
  order_id: number;
  order_number: string;
  public_order_token?: string | null;
}

/**
 * Link to the order summary the visitor just reached: the public summary for
 * a guest (`/pedido/:token`), the account order for a logged-in customer.
 */
export function orderSummaryUrl(order: VexiHandoffOrder, origin: string): string {
  return order.public_order_token
    ? `${origin}/pedido/${order.public_order_token}`
    : `${origin}/account/orders/${order.order_id}`;
}

/**
 * Vexi público F2 (D5): `wa.me` link asking the store about THIS order, with
 * the same «preguntar por WhatsApp» message the order summary uses (order
 * number) plus the summary link. `null` without a valid store number.
 */
export function vexiOrderHandoffUrl(
  whatsappNumber: string | null | undefined,
  storeName: string,
  order: VexiHandoffOrder,
  origin: string,
): string | null {
  return whatsappHref(
    whatsappNumber ?? undefined,
    buildOrderInquiryMessage({
      storeName,
      orderNumber: order.order_number,
      summaryUrl: orderSummaryUrl(order, origin),
    }),
  );
}

/**
 * «Preguntar por WhatsApp» about a placed order (CP-tienda-checkout-whatsapp,
 * anotación 7): a CONSULT message with the order data so the store identifies
 * it without asking again. Single source for the guest order summary button
 * and Vexi público's handoff after checkout (F2), so both send the same format.
 *
 * Optional parts are omitted, never printed empty. `summaryUrl` (the public
 * order summary link) is what Vexi adds; the summary page itself is already
 * that link, so it leaves it out.
 */
export interface OrderInquiryMessageInput {
  storeName: string;
  orderNumber: string | number;
  stateLabel?: string | null;
  /** Pre-rendered product lines (`  - Name (SKU) xN`), joined by `\n`. */
  itemLines?: string | null;
  /** Already formatted with the store currency. */
  totalLabel?: string | null;
  summaryUrl?: string | null;
}

export function buildOrderInquiryMessage(input: OrderInquiryMessageInput): string {
  return (
    `¡Hola! 👋 Quisiera consultar el estado de mi pedido en ${input.storeName}.\n\n` +
    `*Pedido:* #${input.orderNumber}\n` +
    (input.stateLabel ? `*Estado:* ${input.stateLabel}\n` : '') +
    (input.itemLines ? `\n*Productos:*\n${input.itemLines}\n` : '') +
    (input.totalLabel ? `\n*Total:* ${input.totalLabel}\n` : '') +
    (input.summaryUrl ? `\n*Resumen:* ${input.summaryUrl}\n` : '') +
    `\n¡Muchas gracias!`
  );
}

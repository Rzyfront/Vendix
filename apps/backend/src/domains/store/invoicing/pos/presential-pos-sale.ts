/**
 * `orders.fiscal_alert_code` que pinta el banner «Factura sin emitir» del
 * detalle de la orden (frontend `fiscal-alert-dictionary.ts`, CTA «Emitir
 * manualmente»). Lo escriben `WebhookHandlerService.autoSendOrderInvoice`
 * (tienda en línea) y `PosFiscalEmissionService.markAutoSendFailedAlert`
 * (venta presencial): una sola cadena para las dos mitades del banner.
 */
export const INVOICE_AUTO_SEND_FAILED_ALERT = 'INVOICE_AUTO_SEND_FAILED';

/**
 * ¿La venta se consume EN EL LOCAL y se factura por el carril del mostrador?
 *
 * Definición ÚNICA del carril de facturación presencial. La consumen:
 *  - `OrderFlowService.emitPosSaleCompletedIfFullyPaid` (compuerta de
 *    `POS_SALE_COMPLETED_EVENT` tras `flow/pay` y `confirmPayment`),
 *  - `WebhookHandlerService.confirmOrderPaid` (salida temprana: si el flujo de
 *    orden ya disparó el evento, el listener es el único dueño de la emisión),
 *  - `WebhookHandlerService.autoSendOrderInvoice` (qué `auto_emit` aplica:
 *    `invoicing.pos` o `invoicing.ecommerce`).
 *
 * El carril lo decide DÓNDE se consume la venta, no el canal por el que nació:
 *  - `channel = 'pos'` es siempre mostrador.
 *  - `delivery_type = 'dine_in'` también, aunque el `channel` sea `ecommerce`:
 *    una mesa abierta por QR nace con `channel:'ecommerce'` +
 *    `delivery_type:'dine_in'` (`TableSessionsService.openTableSessionPublic`)
 *    sólo para que los reportes distingan la cuenta iniciada por el comensal
 *    de la iniciada en caja. El comensal está en el local: es venta presencial
 *    (decisión del dueño, sep-2026).
 *
 * Una orden ecommerce de domicilio / recogida / `other` NO entra: el checkout
 * web nunca deriva `dine_in` (`deriveDeliveryType` sólo produce `pickup`,
 * `home_delivery` u `other`) y esas órdenes siguen facturándose por su carril
 * (`CheckoutService` crea el borrador, el webhook lo envía).
 */
export function isPresentialPosSale(order: {
  channel?: string | null;
  delivery_type?: string | null;
}): boolean {
  return order.channel === 'pos' || order.delivery_type === 'dine_in';
}

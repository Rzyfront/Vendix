/**
 * Ensambla los payloads de `payment.received` (uno por pago/tramo) para
 * cobros directos que NO pasan por `payments.service.ts` (POS): `payOrder`/
 * `confirmPayment` de `order-flow.service.ts`.
 *
 * Misma forma exacta que el emisor de referencia del POS
 * (`payments.service.ts` ~1843-1891): cada pago toma su `sale_share`
 * (prorrateado SECUENCIALMENTE al crearse — ver
 * `resolvePaymentReceivedSaleFields` y el comentario en
 * `createLegPayments`) y cae a los totales de la orden (`sale_tax`/`order`)
 * cuando no trae `sale_share` (pago escalar, un solo tramo).
 *
 * La retención sufrida se resuelve UNA vez por orden (fuera de esta función,
 * vía `WithholdingFlowService.resolveSufferedByOperation`) y aquí sólo se
 * reparte entre los pagos por monto (`splitWithholdingLines`), igual que el
 * POS — nunca se recalcula ni se persiste acá.
 *
 * Pura: no toca Prisma, no emite nada. El llamador decide cuándo emitir cada
 * payload y cuándo persistir la retención (ver `order-flow.service.ts`,
 * `emitLegPaymentReceivedEvents`).
 *
 * Desviación de diseño respecto al pedido original (reportada en el informe
 * final): NO recibe `tx` ni recalcula `resolvePaymentReceivedSaleFields`
 * internamente. Si lo hiciera DESPUÉS de que todos los tramos ya existen en
 * la DB (que es cuando este helper se invoca — tras el `updateOrderState`
 * exitoso, fuera de la transacción de `createLegPayments`), cada tramo vería
 * a TODOS sus hermanos como «pagos previos» (la consulta sólo filtra
 * `id != payment_id`, no una ventana temporal), rompiendo la garantía de que
 * sólo los tramos genuinamente anteriores cuentan como `prior_amounts` y de
 * que el último tramo absorbe el remanente exacto. Por eso `sale_share` se
 * calcula SECUENCIALMENTE dentro de `createLegPayments` (mismo patrón que
 * `processMultiLegDirectPayment` del POS) y se pasa ya resuelto a este
 * helper, que sólo ensambla.
 */
import type { TaxBreakdownItem } from '@common/interfaces/tax-breakdown.interface';
import type { WithholdingLine } from '@common/interfaces/withholding-breakdown.interface';
import type { PaymentReceivedSaleFields } from './payment-sale-share.util';
import { splitWithholdingLines } from './payment-sale-share.util';

export interface PaymentReceivedEventOrder {
  id: number;
  order_number: string;
  store_id: number;
  organization_id?: number | null;
  customer_id?: number | string | null;
  subtotal_amount?: unknown;
  tip_amount?: unknown;
}

export interface PaymentReceivedEventPaymentInput {
  id: number;
  amount: unknown;
  currency?: string | null;
  /** `store_payment_method.system_payment_method.display_name`. */
  display_name?: string | null;
  /**
   * Prorrateado SECUENCIALMENTE al crear el tramo (ver
   * `resolvePaymentReceivedSaleFields`/`createLegPayments`). Sin él (pago
   * escalar) el payload cae a `sale_tax`/totales de la orden — igual que el
   * POS cuando `legPayment.sale_share` es `undefined`.
   */
  sale_share?: PaymentReceivedSaleFields;
}

export interface BuildPaymentReceivedEventsParams {
  order: PaymentReceivedEventOrder;
  /**
   * Fallback a nivel de orden cuando un pago no trae `sale_share`
   * (`buildOrderSaleTaxPayload`, calculado una vez para todos los tramos).
   */
  sale_tax: {
    tax_amount: number;
    shipping_amount: number;
    tax_breakdown: TaxBreakdownItem[];
    discount_amount: number;
  };
  /** Pagos/tramos en el orden en que se crearon (el orden importa para el reparto de retención). */
  payments: PaymentReceivedEventPaymentInput[];
  /** Líneas de retención sufrida de la orden, ya resueltas UNA vez (puede venir vacío/undefined). */
  withholding_lines?: WithholdingLine[];
  currency: string;
  user_id?: number | null;
}

export interface PaymentReceivedEventPayload {
  payment_id: number;
  store_id: number;
  organization_id?: number | null;
  order_id: number;
  order_number: string;
  amount: unknown;
  subtotal_amount: number;
  tax_amount: number;
  shipping_amount?: number;
  tax_breakdown: TaxBreakdownItem[];
  withholding_breakdown: WithholdingLine[];
  discount_amount: number;
  tip_amount: number;
  currency: string;
  payment_method: string;
  user_id?: number | null;
  customer?: { id: number };
}

export function buildPaymentReceivedEvents(
  params: BuildPaymentReceivedEventsParams,
): PaymentReceivedEventPayload[] {
  const { order, sale_tax, payments, currency, user_id } = params;
  // Retención: UNA vez por orden, repartida entre los tramos por monto
  // (residuo en el último) — mismo criterio que `sale_share`. Con un solo
  // pago devuelve las líneas intactas.
  const withholdingByLeg = splitWithholdingLines(
    params.withholding_lines,
    payments.map((payment) => Number(payment.amount)),
  );

  return payments.map((payment, index) => {
    const share = payment.sale_share;
    return {
      payment_id: payment.id,
      store_id: order.store_id,
      organization_id: order.organization_id,
      order_id: order.id,
      order_number: order.order_number,
      amount: payment.amount,
      subtotal_amount:
        share?.subtotal_amount ?? Number(order.subtotal_amount || 0),
      tax_amount: share?.tax_amount ?? sale_tax.tax_amount,
      shipping_amount: share?.shipping_amount ?? sale_tax.shipping_amount,
      tax_breakdown: share ? (share.tax_breakdown ?? []) : sale_tax.tax_breakdown,
      withholding_breakdown: withholdingByLeg[index] ?? [],
      discount_amount: share?.discount_amount ?? sale_tax.discount_amount,
      tip_amount: share?.tip_amount ?? Number(order.tip_amount || 0),
      currency: payment.currency || currency,
      payment_method: payment.display_name || 'Unknown',
      user_id: user_id ?? undefined,
      customer: order.customer_id ? { id: Number(order.customer_id) } : undefined,
    };
  });
}

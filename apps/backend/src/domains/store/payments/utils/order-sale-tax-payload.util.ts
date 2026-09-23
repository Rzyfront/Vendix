import {
  buildTaxBreakdown,
  type TaxBreakdownItem,
} from '@common/interfaces/tax-breakdown.interface';
import {
  buildShippingTaxBreakdownRow,
  shippingNetBase,
  type ShippingTaxOrderInput,
} from '../../shipping/utils/shipping-tax.util';

/**
 * Fila de impuesto de producto tal como la leen los emisores de asientos de
 * venta (POS directo, crédito, webhook): `order_item_taxes` con la base
 * (`order_items.total_price`) ya adjunta. Ver F-111 en `payments.service.ts`.
 */
export interface OrderSaleProductTaxRow {
  tax_type?: string | null;
  tax_amount: unknown;
  tax_rate?: unknown;
  taxable_amount?: unknown;
}

export interface OrderSaleTaxPayloadOrder extends ShippingTaxOrderInput {
  /** `orders.tax_amount`: SOLO impuesto de productos (contrato shipping-rate-tax). */
  tax_amount?: unknown;
}

export interface OrderSaleTaxPayload {
  /** Impuesto total del asiento = productos + impuesto del envío. */
  tax_amount: number;
  /** Flete NETO para 414505 = `shipping_cost − shipping_tax_amount`. */
  shipping_amount: number;
  /** Desglose tipado: productos + (si hay copia) la fila del envío. */
  tax_breakdown: TaxBreakdownItem[];
}

const toCents = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * Carga tributaria de una venta para los eventos `payment.received` /
 * `credit_sale.created` sin factura. Una sola definición para POS y webhook.
 *
 * `orders.tax_amount` NO incluye el impuesto del envío y `shipping_cost` es el
 * BRUTO (lo que paga el cliente). El asiento necesita:
 * - `shipping_amount` = base neta del envío (CR 414505),
 * - `tax_amount` = impuesto de productos + impuesto del envío,
 * - `tax_breakdown` = filas de productos + una fila propia del envío con
 *   `taxable_amount` = base (compuerta F-111 por separado, sin mezclar su
 *   base con la de productos de la misma tarifa).
 *
 * Así DR caja/CxC (= grand_total) = revenue + 414505 + IVA + INC al centavo.
 *
 * Sin copia (`shipping_tax_amount` = 0) la salida es idéntica a la de antes:
 * `shipping_amount = shipping_cost`, `tax_amount = orders.tax_amount`,
 * desglose solo de productos.
 *
 * Borde legado: si los productos NO dejaron filas tipadas pero la orden sí
 * tiene `tax_amount` > 0, el asiento hoy cae a la línea legada `vat_payable`
 * (2408) por el total escalar. Como añadir la fila del envío vuelve el
 * desglose no vacío (y `resolveTaxLines` ignora entonces el total escalar),
 * se antepone una fila `iva` por ese impuesto de productos: misma cuenta que
 * la línea legada, el asiento sigue cuadrando.
 */
export function buildOrderSaleTaxPayload(input: {
  product_tax_rows: ReadonlyArray<OrderSaleProductTaxRow>;
  order: OrderSaleTaxPayloadOrder;
}): OrderSaleTaxPayload {
  const { order } = input;
  const product_breakdown = buildTaxBreakdown([...(input.product_tax_rows ?? [])]);
  const product_tax_cents = toCents(order.tax_amount);
  const shipping_row = buildShippingTaxBreakdownRow(order);

  if (!shipping_row) {
    return {
      tax_amount: product_tax_cents / 100,
      shipping_amount: Math.max(0, toCents(order.shipping_cost)) / 100,
      tax_breakdown: product_breakdown,
    };
  }

  const breakdown: TaxBreakdownItem[] = [...product_breakdown];
  if (breakdown.length === 0 && product_tax_cents > 0) {
    breakdown.push({ tax_type: 'iva', tax_amount: product_tax_cents / 100 });
  }
  breakdown.push({
    tax_type: shipping_row.tax_type,
    tax_amount: shipping_row.tax_amount,
    ...(shipping_row.tax_rate > 0 && shipping_row.tax_rate <= 1
      ? { tax_rate: shipping_row.tax_rate, taxable_amount: shipping_row.taxable_amount }
      : {}),
  });

  return {
    tax_amount: (product_tax_cents + toCents(shipping_row.tax_amount)) / 100,
    shipping_amount: shippingNetBase(order),
    tax_breakdown: breakdown,
  };
}

import { Logger } from '@nestjs/common';
import {
  buildTaxBreakdown,
  type TaxBreakdownItem,
} from '@common/interfaces/tax-breakdown.interface';
import {
  buildShippingTaxBreakdownRow,
  shippingNetBase,
  type ShippingTaxOrderInput,
} from '../../shipping/utils/shipping-tax.util';
import {
  projectOrderInvoiceLines,
  type OrderInvoiceLineSource,
} from '../../invoicing/utils/order-invoice-lines.util';

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

/**
 * Línea de orden para la proyección del descuento. Mismo contrato que
 * `OrderInvoiceLineSource` salvo `tax_name`, que la proyección no lee y los
 * emisores de asientos no seleccionan.
 */
export type OrderSaleLineSource = Omit<OrderInvoiceLineSource, 'order_item_taxes'> & {
  order_item_taxes?: Array<
    Omit<NonNullable<OrderInvoiceLineSource['order_item_taxes']>[number], 'tax_name'>
  > | null;
};

export interface OrderSaleTaxPayloadOrder extends ShippingTaxOrderInput {
  /** `orders.tax_amount`: SOLO impuesto de productos (contrato shipping-rate-tax). */
  tax_amount?: unknown;
  /** `orders.discount_amount`: descuento de ORDEN (después de impuesto). */
  discount_amount?: unknown;
  /** `orders.subtotal_amount` = Σ `order_items.total_price` (base). */
  subtotal_amount?: unknown;
  /** Sólo para el aviso cuando la proyección no reconcilia (sin PII). */
  id?: unknown;
}

export interface OrderSaleTaxPayload {
  /** Impuesto total del asiento = productos + impuesto del envío. */
  tax_amount: number;
  /** Flete NETO para 414505 = `shipping_cost − shipping_tax_amount`. */
  shipping_amount: number;
  /** Desglose tipado: productos + (si hay copia) la fila del envío. */
  tax_breakdown: TaxBreakdownItem[];
  /**
   * Descuento a debitar en 4175 (`*.sales_discount`). Sin proyección es
   * `orders.discount_amount` tal cual. Con descuento de orden proyectado es
   * SÓLO la parte de BASE del descuento (Σ `total_price − base` de línea): la
   * parte de impuesto ya no se acredita, porque el impuesto sale neto.
   */
  discount_amount: number;
  /** `true` cuando el impuesto de productos salió de `projectOrderInvoiceLines`. */
  discount_projected: boolean;
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
  /**
   * Líneas de la orden con sus `order_item_taxes` (tarifa en fracción). Sólo
   * se usan si la orden trae descuento de orden: ver `projectOrderDiscountedTaxes`.
   */
  order_items?: ReadonlyArray<OrderSaleLineSource> | null;
}): OrderSaleTaxPayload {
  const { order } = input;
  const projected = projectOrderDiscountedTaxes(input.order_items, order, 'orden');
  const product_breakdown = projected
    ? projected.product_breakdown
    : buildTaxBreakdown([...(input.product_tax_rows ?? [])]);
  const product_tax_cents = projected
    ? projected.product_tax_cents
    : toCents(order.tax_amount);
  const discount_amount =
    (projected ? projected.discount_cents : Math.max(0, toCents(order.discount_amount))) /
    100;
  const discount_projected = !!projected;
  const shipping_row = buildShippingTaxBreakdownRow(order);

  if (!shipping_row) {
    return {
      tax_amount: product_tax_cents / 100,
      shipping_amount: Math.max(0, toCents(order.shipping_cost)) / 100,
      tax_breakdown: product_breakdown,
      discount_amount,
      discount_projected,
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
    discount_amount,
    discount_projected,
  };
}

/**
 * Descuento de ORDEN en el asiento sin factura — misma proyección que la
 * factura (`projectOrderInvoiceLines`, art. 454 ET: el descuento incondicional
 * reduce la base).
 *
 * POS y checkout restan `orders.discount_amount` del `grand_total` DESPUÉS del
 * impuesto; `orders.tax_amount` y `order_item_taxes` quedan pre-descuento. El
 * asiento histórico debitaba el descuento BRUTO en 4175 y acreditaba el IVA /
 * INC pre-descuento: el libro llevaba más impuesto que la factura (27.000 vs
 * 25.906,87 en el caso IVA 19 % + INC 8 % + exento con 10.000 de descuento).
 *
 * Decisión contable: el ingreso se sigue acreditando por el subtotal BRUTO de
 * base (`orders.subtotal_amount`) y 4175 recibe SÓLO la parte de base del
 * descuento (Σ `total_price − base proyectada`); cada impuesto se acredita por
 * su cuota proyectada. Así 4175 sigue mostrando el descuento comercial concedido
 * (neto de impuesto) y DR caja + DR 4175 = CR ingreso + CR impuestos + CR flete
 * al centavo, porque la proyección cierra `Σ base + Σ cuota = Σ bruto −
 * descuento`. El envío no recibe descuento.
 *
 * Devuelve `null` (payload histórico intacto) sin descuento, sin líneas, si la
 * proyección falla, o si la orden no reconcilia con sus líneas (Σ cuotas ≠
 * `orders.tax_amount`, Σ `total_price` ≠ `orders.subtotal_amount`, o la parte
 * de base + la parte de impuesto ≠ descuento).
 */
export interface OrderDiscountedTaxes {
  /** Desglose por tipo (y tarifa) con la cuota neta del descuento. */
  product_breakdown: TaxBreakdownItem[];
  /** Σ cuotas proyectadas, en centavos. */
  product_tax_cents: number;
  /** Parte de BASE del descuento (4175), en centavos. */
  discount_cents: number;
}

const logger = new Logger('OrderSaleTaxPayload');

/**
 * Aviso de caída al payload histórico: la orden trae descuento pero la
 * proyección no reconcilia. Sólo identificadores y cifras, nunca datos del
 * cliente.
 */
function warnFallback(
  scope: string,
  order: OrderSaleTaxPayloadOrder,
  reason: string,
  detail: Record<string, unknown> = {},
) {
  logger.warn(
    `Descuento de ${scope} sin proyección fiscal (${reason}); el asiento usa el impuesto pre-descuento. ` +
      JSON.stringify({ id: order.id ?? null, ...detail }),
  );
}

/**
 * Proyección del descuento de orden sobre las líneas para los ASIENTOS
 * (POS, crédito, webhook, cuenta dividida y cuenta financiera). Única
 * definición: la usan `buildOrderSaleTaxPayload` y el carril de cuenta
 * financiera de `AutoEntryService`.
 *
 * `null` sin descuento (sin aviso: el asiento es el histórico por diseño) o
 * cuando no reconcilia (con `logger.warn`).
 */
export function projectOrderDiscountedTaxes(
  order_items: ReadonlyArray<OrderSaleLineSource> | null | undefined,
  order: OrderSaleTaxPayloadOrder,
  scope: string,
): OrderDiscountedTaxes | null {
  const discount_cents = toCents(order.discount_amount);
  if (discount_cents <= 0) return null;
  if (!order_items || order_items.length === 0) {
    warnFallback(scope, order, 'sin_lineas');
    return null;
  }
  const projection = projectOrderInvoiceLines(
    order_items as ReadonlyArray<OrderInvoiceLineSource>,
    order.discount_amount,
  );
  if (
    projection.error ||
    toCents(projection.allocated_discount.toString()) !== discount_cents
  ) {
    warnFallback(scope, order, projection.error?.code ?? 'descuento_no_repartido', {
      discount: discount_cents / 100,
      allocated: projection.allocated_discount.toFixed(2),
    });
    return null;
  }

  let original_tax_cents = 0;
  let projected_tax_cents = 0;
  let subtotal_cents = 0;
  let base_discount_cents = 0;
  const rows: OrderSaleProductTaxRow[] = [];
  order_items.forEach((item, index) => {
    const line = projection.lines[index];
    subtotal_cents += toCents(item.total_price);
    base_discount_cents += toCents(line.discount.toString());
    projected_tax_cents += toCents(line.tax_total.toString());
    const item_rows = item.order_item_taxes ?? [];
    if (item_rows.length === 0) {
      original_tax_cents += toCents(line.tax_total.toString());
      return;
    }
    item_rows.forEach((row, row_index) => {
      original_tax_cents += toCents(row.tax_amount);
      rows.push({
        tax_type: (row.tax_type as string | null | undefined) ?? null,
        tax_amount: line.tax_amounts[row_index]?.toString() ?? 0,
        tax_rate: row.tax_rate,
        taxable_amount: line.base.toString(),
      });
    });
  });

  if (
    original_tax_cents !== toCents(order.tax_amount) ||
    (order.subtotal_amount != null &&
      subtotal_cents !== toCents(order.subtotal_amount)) ||
    base_discount_cents + (original_tax_cents - projected_tax_cents) !==
      discount_cents ||
    base_discount_cents < 0
  ) {
    warnFallback(scope, order, 'no_reconcilia', {
      tax_lines: original_tax_cents / 100,
      tax_header: toCents(order.tax_amount) / 100,
      subtotal_lines: subtotal_cents / 100,
      subtotal_header:
        order.subtotal_amount != null ? toCents(order.subtotal_amount) / 100 : null,
    });
    return null;
  }

  return {
    product_breakdown: buildTaxBreakdown(rows),
    product_tax_cents: projected_tax_cents,
    discount_cents: base_discount_cents,
  };
}

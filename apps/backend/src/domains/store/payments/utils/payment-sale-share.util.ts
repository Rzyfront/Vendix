/**
 * Porción de la venta que reconoce UN pago parcial de la orden.
 *
 * `payment.received` (rama «sin factura» de AutoEntryService.onPaymentReceived)
 * debita caja por `amount` y acredita subtotal + impuesto + flete + propina. Si
 * cada pago parcial (mesas con cuenta dividida) emite los totales de la ORDEN,
 * el asiento no cuadra (DR = pago, CR = orden entera) y se rechaza.
 *
 * Reparto: se reproducen los pagos previos de la orden en orden y cada uno toma
 * su parte del REMANENTE de cada componente por mayor residuo en centavos. Así:
 *   · Σ componentes del pago = monto del pago, al centavo (el asiento cuadra);
 *   · el pago que completa la orden toma el remanente exacto (Σ pagos = orden);
 *   · un pago único por el total devuelve los totales de la orden intactos.
 *
 * Devuelve `null` (el llamador conserva el payload histórico) cuando los datos
 * no permiten un reparto honesto: componentes que no suman el total de la orden,
 * o pagos que exceden lo que queda por reconocer.
 */
import type { TaxBreakdownItem } from '@common/interfaces/tax-breakdown.interface';
import { buildOrderSaleTaxPayload } from './order-sale-tax-payload.util';

export interface PaymentSaleShareInput {
  subtotal_amount: number;
  discount_amount?: number;
  /** Impuesto de productos + impuesto del envío. */
  tax_amount: number;
  /** Flete NETO del impuesto del envío. */
  shipping_amount?: number;
  tip_amount?: number;
  /**
   * Desglose del impuesto por tipo (Σ = `tax_amount`). Si viene, cada fila se
   * reparte como componente propio y la porción devuelve `tax_breakdown`.
   */
  tax_rows?: Array<Pick<TaxBreakdownItem, 'tax_type' | 'tax_amount'>>;
  grand_total: number;
  /** Monto de ESTE pago. */
  amount: number;
  /** Montos de los otros pagos ya liquidados de la orden, en su orden. */
  prior_amounts: number[];
}

export interface PaymentSaleShare {
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  shipping_amount: number;
  tip_amount: number;
  /** Sólo cuando la entrada trajo `tax_rows`. */
  tax_breakdown?: TaxBreakdownItem[];
}

const toCents = (value: number | null | undefined) =>
  Math.round(Number(value || 0) * 100);
const fromCents = (cents: number) => cents / 100;

/** Reparte `amount` sobre `weights` por mayor residuo; Σ resultado = amount. */
function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || amount <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const floors = raw.map((r) => Math.floor(r));
  let left = amount - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

export function computePaymentSaleShare(
  input: PaymentSaleShareInput,
): PaymentSaleShare | null {
  const discount = toCents(input.discount_amount);
  const tax_rows = input.tax_rows?.length ? input.tax_rows : null;
  const tax_components = tax_rows
    ? tax_rows.map((row) => toCents(row.tax_amount))
    : [toCents(input.tax_amount)];
  const components = [
    toCents(input.subtotal_amount) - discount, // ingreso neto
    ...tax_components,
    toCents(input.shipping_amount),
    toCents(input.tip_amount),
  ];
  const grand_total = toCents(input.grand_total);
  if (
    discount < 0 ||
    components.some((c) => c < 0) ||
    components.reduce((a, b) => a + b, 0) !== grand_total ||
    (tax_rows &&
      tax_components.reduce((a, b) => a + b, 0) !== toCents(input.tax_amount))
  ) {
    return null;
  }

  let remaining = [...components];
  let remaining_discount = discount;
  const take = (amount: number) => {
    const available = remaining.reduce((a, b) => a + b, 0);
    if (amount <= 0 || amount > available) return null;
    const shares = allocate(amount, remaining);
    const disc =
      remaining[0] > 0
        ? Math.round((remaining_discount * shares[0]) / remaining[0])
        : amount === available
          ? remaining_discount
          : 0;
    remaining = remaining.map((r, i) => r - shares[i]);
    remaining_discount -= disc;
    return { shares, disc };
  };

  for (const prior of input.prior_amounts) {
    if (!take(toCents(prior))) return null;
  }
  const current = take(toCents(input.amount));
  if (!current) return null;

  const shares = current.shares;
  const net = shares[0];
  const taxes = shares.slice(1, 1 + tax_components.length);
  const shipping = shares[1 + tax_components.length];
  const tip = shares[2 + tax_components.length];
  return {
    subtotal_amount: fromCents(net + current.disc),
    discount_amount: fromCents(current.disc),
    tax_amount: fromCents(taxes.reduce((a, b) => a + b, 0)),
    shipping_amount: fromCents(shipping),
    tip_amount: fromCents(tip),
    ...(tax_rows
      ? {
          tax_breakdown: tax_rows
            .map((row, index) => ({
              tax_type: row.tax_type,
              tax_amount: fromCents(taxes[index]),
            }))
            .filter((row) => row.tax_amount > 0),
        }
      : {}),
  };
}

/** Campos de venta del evento `payment.received` para un pago de la orden. */
export interface PaymentReceivedSaleFields {
  subtotal_amount: number;
  tax_amount: number;
  shipping_amount?: number;
  discount_amount: number;
  tip_amount: number;
  /**
   * Desglose por tipo de la porción: el proyectado con descuento/deriva, o
   * (M6) el de las filas tipadas de la orden repartiendo el impuesto
   * histórico de la porción, sin cambiar montos.
   */
  tax_breakdown?: TaxBreakdownItem[];
}

/**
 * Lee la orden y los OTROS pagos liquidados dentro de la misma transacción y
 * devuelve la porción de venta de este pago. Si el reparto no es posible,
 * devuelve los totales de la orden (payload histórico).
 */
export async function resolvePaymentReceivedSaleFields(
  tx: {
    orders: { findUnique: (args: any) => Promise<any> };
    payments: { findMany: (args: any) => Promise<any[]> };
  },
  args: { order_id: number; payment_id: number; amount: number },
): Promise<PaymentReceivedSaleFields> {
  const order = await tx.orders.findUnique({
    where: { id: args.order_id },
    select: {
      subtotal_amount: true,
      discount_amount: true,
      tax_amount: true,
      shipping_cost: true,
      shipping_tax_amount: true,
      tip_amount: true,
      grand_total: true,
      shipping_tax_type: true,
      shipping_tax_rate: true,
      // Descuento de orden: el impuesto de la porción sale de la MISMA
      // proyección que la factura (`buildOrderSaleTaxPayload`).
      order_items: {
        where: { cancelled_at: null },
        select: {
          total_price: true,
          quantity: true,
          tax_amount_item: true,
          weight: true,
          price_unit_quantity: true,
          order_item_taxes: {
            select: { tax_type: true, tax_amount: true, tax_rate: true },
          },
        },
      },
    },
  });
  const legacy: PaymentReceivedSaleFields = {
    subtotal_amount: Number(order?.subtotal_amount || 0),
    tax_amount: Number(order?.tax_amount || 0),
    discount_amount: Number(order?.discount_amount || 0),
    tip_amount: Number(order?.tip_amount || 0),
  };
  if (!order) return legacy;

  const prior = await tx.payments.findMany({
    where: {
      order_id: args.order_id,
      state: { in: ['succeeded', 'captured'] },
      id: { not: args.payment_id },
    },
    select: { amount: true },
    orderBy: { id: 'asc' },
  });
  // Descuento de orden: impuesto por tipo neto del descuento y 4175 sólo por
  // la parte de base. Sin descuento (o si no reconcilia) sigue el reparto
  // histórico, idéntico.
  const sale_tax = Array.isArray(order.order_items)
    ? buildOrderSaleTaxPayload({
        product_tax_rows: [],
        order: { ...order, id: args.order_id },
        order_items: order.order_items,
      })
    : null;
  if (sale_tax?.discount_projected) {
    const tax_rows = sale_tax.tax_breakdown.map((row) => ({
      tax_type: row.tax_type,
      tax_amount: row.tax_amount,
    }));
    const projected_share = computePaymentSaleShare({
      subtotal_amount: Number(order.subtotal_amount || 0),
      discount_amount: sale_tax.discount_amount,
      tax_amount: sale_tax.tax_amount,
      tax_rows,
      shipping_amount: sale_tax.shipping_amount,
      tip_amount: Number(order.tip_amount || 0),
      grand_total: Number(order.grand_total || 0),
      amount: args.amount,
      prior_amounts: prior.map((row) => Number(row.amount || 0)),
    });
    if (projected_share) return projected_share;
  }

  const shipping_tax = Number(order.shipping_tax_amount || 0);
  const legacy_share_input = {
    subtotal_amount: Number(order.subtotal_amount || 0),
    discount_amount: Number(order.discount_amount || 0),
    // `orders.tax_amount` NO incluye el impuesto del envío (va bruto en
    // shipping_cost): se suma aquí y el flete queda NETO.
    tax_amount: Number(order.tax_amount || 0) + shipping_tax,
    shipping_amount: Number(order.shipping_cost || 0) - shipping_tax,
    tip_amount: Number(order.tip_amount || 0),
    grand_total: Number(order.grand_total || 0),
    amount: args.amount,
    prior_amounts: prior.map((row) => Number(row.amount || 0)),
  };
  const share = computePaymentSaleShare(legacy_share_input);
  if (!share) return legacy;
  const tax_breakdown = typedShareBreakdown(order, args.order_id, share, (tax_rows) =>
    computePaymentSaleShare({ ...legacy_share_input, tax_rows }),
  );
  return tax_breakdown ? { ...share, tax_breakdown } : share;
}

/**
 * M6 — desglose tipado de la porción SIN proyección (sin descuento ni
 * deriva). No cambia ningún monto: reparte el `tax_amount` ya calculado de la
 * porción entre las filas tipadas de la orden (productos por tipo + envío).
 * Sin él el asiento cae a la línea legada `vat_payable` (2408) y pierde el
 * tipo (IVA 240802 / INC 243605).
 *
 * `undefined` cuando la orden no tiene filas tipadas o no suman su impuesto.
 */
function typedShareBreakdown(
  order: any,
  order_id: number,
  share: PaymentSaleShare,
  shareWithRows: (
    tax_rows: Array<Pick<TaxBreakdownItem, 'tax_type' | 'tax_amount'>>,
  ) => PaymentSaleShare | null,
): TaxBreakdownItem[] | undefined {
  const items: any[] = Array.isArray(order.order_items) ? order.order_items : [];
  const product_tax_rows = items.flatMap((item) =>
    (item.order_item_taxes ?? []).map((row: any) => ({
      tax_type: row.tax_type ?? null,
      tax_amount: row.tax_amount,
      tax_rate: row.tax_rate,
      taxable_amount: item.total_price,
    })),
  );
  if (product_tax_rows.length === 0) return undefined;
  // Descuento en 0 sólo para esta lectura: sin líneas la proyección no corre y
  // el desglose es el de las filas de la orden (el descuento no lo altera).
  const typed = buildOrderSaleTaxPayload({
    product_tax_rows,
    order: { ...order, id: order_id, discount_amount: 0 },
  });
  // Una fila por tipo (el desglose de la porción no lleva tarifa ni base).
  const by_type = new Map<TaxBreakdownItem['tax_type'], number>();
  for (const row of typed.tax_breakdown) {
    by_type.set(row.tax_type, (by_type.get(row.tax_type) ?? 0) + toCents(row.tax_amount));
  }
  const rows = [...by_type.entries()].map(([tax_type, cents]) => ({
    tax_type,
    tax_amount: fromCents(cents),
  }));
  const row_cents = rows.map((row) => toCents(row.tax_amount));
  const share_tax_cents = toCents(share.tax_amount);
  if (
    rows.length === 0 ||
    row_cents.some((c) => c < 0) ||
    row_cents.reduce((a, b) => a + b, 0) !==
      toCents(Number(order.tax_amount || 0) + Number(order.shipping_tax_amount || 0))
  ) {
    return undefined;
  }
  // Preferente: el reparto por filas del mismo historial de pagos (el último
  // pago cierra cada fila al centavo). Si su impuesto difiere del de la
  // porción histórica, se reparte el de la porción por peso de fila.
  const with_rows = shareWithRows(rows);
  const tax_cents =
    with_rows?.tax_breakdown &&
    toCents(with_rows.tax_amount) === share_tax_cents
      ? rows.map(
          (row) =>
            toCents(
              with_rows.tax_breakdown!.find((r) => r.tax_type === row.tax_type)
                ?.tax_amount,
            ),
        )
      : allocate(share_tax_cents, row_cents);
  if (tax_cents.reduce((a, b) => a + b, 0) !== share_tax_cents) {
    return undefined;
  }
  return rows
    .map((row, index) => ({
      tax_type: row.tax_type,
      tax_amount: fromCents(tax_cents[index]),
    }))
    .filter((row) => row.tax_amount > 0);
}

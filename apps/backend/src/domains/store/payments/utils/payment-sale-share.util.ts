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
export interface PaymentSaleShareInput {
  subtotal_amount: number;
  discount_amount?: number;
  /** Impuesto de productos + impuesto del envío. */
  tax_amount: number;
  /** Flete NETO del impuesto del envío. */
  shipping_amount?: number;
  tip_amount?: number;
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
  const components = [
    toCents(input.subtotal_amount) - discount, // ingreso neto
    toCents(input.tax_amount),
    toCents(input.shipping_amount),
    toCents(input.tip_amount),
  ];
  const grand_total = toCents(input.grand_total);
  if (
    discount < 0 ||
    components.some((c) => c < 0) ||
    components.reduce((a, b) => a + b, 0) !== grand_total
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

  const [net, tax, shipping, tip] = current.shares;
  return {
    subtotal_amount: fromCents(net + current.disc),
    discount_amount: fromCents(current.disc),
    tax_amount: fromCents(tax),
    shipping_amount: fromCents(shipping),
    tip_amount: fromCents(tip),
  };
}

/** Campos de venta del evento `payment.received` para un pago de la orden. */
export interface PaymentReceivedSaleFields {
  subtotal_amount: number;
  tax_amount: number;
  shipping_amount?: number;
  discount_amount: number;
  tip_amount: number;
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
  const shipping_tax = Number(order.shipping_tax_amount || 0);
  const share = computePaymentSaleShare({
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
  });
  return share ?? legacy;
}

/**
 * Desglose de una orden leído SOLO de lo persistido (display-only, aditivo).
 *
 * El detalle de la orden mostraba la base sin impuesto como si fuera el
 * precio de la línea: los finales se recalculaban con las tasas vigentes del
 * producto y, con tasa incluida, ese cálculo devuelve la base. Aquí no se
 * recalcula nada: base = `total_price`, descuento = `discount_amount` de la
 * línea e impuesto = las filas de `order_item_taxes` (cada fila ya es el
 * total de esa tasa en la línea, sobre la base descontada).
 *
 * Una línea sin filas de impuesto (orden anterior al desglose) no inventa
 * impuesto: sale con `tax_total` 0 y su total es base − descuento.
 */

export interface OrderBreakdownTax {
  name: string;
  rate: number | null;
  tax_type: string | null;
  amount: number;
}

export interface OrderLineBreakdown {
  base: number;
  discount: number;
  taxes: OrderBreakdownTax[];
  tax_total: number;
  total: number;
}

export interface OrderTotalsBreakdown {
  subtotal_base: number;
  discount: number;
  taxes: OrderBreakdownTax[];
  tax_total: number;
  shipping: number;
  tip: number;
  grand_total: number;
  /** `false` = orden vieja que no cuadra: se muestra el total persistido. */
  reconciles: boolean;
}

interface BreakdownTaxRow {
  tax_name?: unknown;
  tax_rate?: unknown;
  tax_type?: unknown;
  tax_amount?: unknown;
}

interface BreakdownLine {
  total_price?: unknown;
  discount_amount?: unknown;
  cancelled_at?: unknown;
  order_item_taxes?: Array<BreakdownTaxRow | null> | null;
}

interface BreakdownOrder {
  discount_amount?: unknown;
  tax_amount?: unknown;
  shipping_cost?: unknown;
  tip_amount?: unknown;
  grand_total?: unknown;
  order_items?: BreakdownLine[] | null;
}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toCents = (value: number): number => Math.round(value * 100);

export function buildOrderLineBreakdown(
  line: BreakdownLine,
): OrderLineBreakdown {
  const base = round2(num(line.total_price));
  const discount = round2(Math.max(0, num(line.discount_amount)));
  const taxes: OrderBreakdownTax[] = (line.order_item_taxes ?? [])
    .filter((row): row is BreakdownTaxRow => row != null)
    .map((row) => ({
      name: String(row.tax_name ?? '').trim() || 'Impuesto',
      rate: row.tax_rate == null ? null : num(row.tax_rate),
      tax_type: row.tax_type == null ? null : String(row.tax_type),
      amount: round2(num(row.tax_amount)),
    }));
  const tax_total = round2(taxes.reduce((sum, tax) => sum + tax.amount, 0));
  return {
    base,
    discount,
    taxes,
    tax_total,
    total: round2(base - discount + tax_total),
  };
}

/**
 * Totales de la orden desde las líneas vivas. El impuesto se agrupa por
 * nombre + tasa. Si las filas no explican el `tax_amount` de la cabecera
 * (orden vieja o sin desglose), se devuelve una sola fila genérica con el
 * impuesto persistido en vez de un desglose que no suma.
 */
export function buildOrderTotalsBreakdown(
  order: BreakdownOrder,
): OrderTotalsBreakdown {
  const liveLines = (order.order_items ?? []).filter(
    (line) => line.cancelled_at == null,
  );
  let subtotalCents = 0;
  const grouped = new Map<string, OrderBreakdownTax & { cents: number }>();
  for (const line of liveLines) {
    const breakdown = buildOrderLineBreakdown(line);
    subtotalCents += toCents(breakdown.base);
    for (const tax of breakdown.taxes) {
      const key = `${tax.name}|${tax.rate ?? ''}`;
      const current = grouped.get(key) ?? { ...tax, amount: 0, cents: 0 };
      current.cents += toCents(tax.amount);
      grouped.set(key, current);
    }
  }

  const headerTaxCents = toCents(num(order.tax_amount));
  const rowsTaxCents = [...grouped.values()].reduce(
    (sum, tax) => sum + tax.cents,
    0,
  );
  // Tolerancia: 1 centavo por línea (cada fila se redondeó por separado).
  const rowsExplainHeader =
    grouped.size > 0 &&
    Math.abs(rowsTaxCents - headerTaxCents) <= Math.max(1, liveLines.length);

  const taxes: OrderBreakdownTax[] = rowsExplainHeader
    ? [...grouped.values()]
        .filter((tax) => tax.cents !== 0)
        .map(({ cents, ...tax }) => ({ ...tax, amount: cents / 100 }))
    : headerTaxCents > 0
      ? [
          {
            name: 'Impuesto',
            rate: null,
            tax_type: null,
            amount: headerTaxCents / 100,
          },
        ]
      : [];
  const taxCents = rowsExplainHeader ? rowsTaxCents : headerTaxCents;

  const discountCents = toCents(Math.max(0, num(order.discount_amount)));
  const shippingCents = toCents(num(order.shipping_cost));
  const tipCents = toCents(num(order.tip_amount));
  const grandTotalCents = toCents(num(order.grand_total));
  const computedCents =
    subtotalCents - discountCents + taxCents + shippingCents + tipCents;

  return {
    subtotal_base: subtotalCents / 100,
    discount: discountCents / 100,
    taxes,
    tax_total: taxCents / 100,
    shipping: shippingCents / 100,
    tip: tipCents / 100,
    grand_total: grandTotalCents / 100,
    reconciles:
      Math.abs(computedCents - grandTotalCents) <=
      Math.max(1, liveLines.length),
  };
}

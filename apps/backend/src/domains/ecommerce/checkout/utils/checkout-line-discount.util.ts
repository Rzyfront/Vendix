import {
  applyGrossDiscountRetax,
  resolveGrossDiscountByLine,
  type GrossDiscountSplit,
  type GrossDiscountableLine,
} from '../../../store/taxes/utils/order-discount-tax.util';

/**
 * Línea del checkout tal como se va a persistir (`itemsWithTaxes`).
 * `item_taxes[].amount` es la cuota POR UNIDAD (se persiste × cantidad).
 */
export interface CheckoutDiscountLineInput {
  quantity: number;
  /** Base gravable de la línea (`order_items.total_price`). */
  total_net: number;
  /** Impuesto de la línea ANTES del descuento (el que suma la cabecera). */
  total_tax: number;
  item_taxes: ReadonlyArray<{
    rate: number;
    amount: number;
    tax_type?: string | null;
    tax_rate_id?: number | null;
    name?: string | null;
  }>;
}

export interface CheckoutDiscountedLine {
  /** Descuento de BASE de la línea (`order_items.discount_amount`). */
  discount_amount: number;
  /** Cuota post-descuento de cada fila (`order_item_taxes.tax_amount`, línea completa). */
  tax_amounts: number[];
  /** Impuesto post-descuento por unidad (`order_items.tax_amount_item`). */
  tax_amount_item: number;
}

export interface CheckoutLineDiscountResult {
  lines: CheckoutDiscountedLine[];
  /** Σ impuesto post-descuento (`orders.tax_amount`). */
  total_tax: number;
  /** Σ descuento de base (`orders.discount_amount`). */
  total_base_discount: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Contrato NUEVO de descuento en el checkout ecommerce (F1, mismo kernel que
 * el POS): el descuento bruto (promoción + cupón) se reparte por línea —la
 * promoción sólo a las líneas a las que el motor la aplicó, el cupón sobre el
 * bruto remanente— se traslada a la BASE y el impuesto de cada fila se
 * recalcula sobre la base descontada. Lo que paga el cliente no cambia: el
 * kernel cierra a centavo contra `Σ bruto − descuento`.
 *
 * Sin descuento devuelve `null` y la orden se persiste exactamente como antes
 * (contrato legado, `order_items.discount_amount` NULL): así la factura sigue
 * re-despejando las líneas con deriva de cuota por unidad (P2-1).
 */
export function applyCheckoutLineDiscounts(
  lines: ReadonlyArray<CheckoutDiscountLineInput>,
  split: GrossDiscountSplit,
): CheckoutLineDiscountResult | null {
  const total = round2(
    Math.max(0, Number(split.promotionTotal) || 0) +
      Math.max(0, Number(split.couponTotal) || 0),
  );
  if (total <= 0 || lines.length === 0) return null;

  const discountable: GrossDiscountableLine[] = lines.map((line) => {
    const base = Number(line.total_net) || 0;
    const quantity = Number(line.quantity) || 0;
    return {
      base,
      grossOriginal: round2(base + (Number(line.total_tax) || 0)),
      taxRows: line.item_taxes.map((row) => {
        const rate = Number(row.rate) || 0;
        // Fila sin tarifa pero con cuota (histórica): se deriva de la cuota
        // para no anular el impuesto al recalcular (igual que el POS).
        const lineAmount = (Number(row.amount) || 0) * quantity;
        return {
          rate: rate > 0 ? rate : base > 0 && lineAmount > 0 ? lineAmount / base : 0,
          tax_type: row.tax_type ?? null,
          tax_rate_id: row.tax_rate_id ?? null,
          tax_name: row.name ?? null,
        };
      }),
    };
  });

  const grossDiscountByLine = resolveGrossDiscountByLine(
    discountable.map((l) => l.grossOriginal),
    split,
  );
  const retax = applyGrossDiscountRetax(discountable, grossDiscountByLine);

  return {
    lines: retax.lines.map((line, i) => {
      const quantity = Number(lines[i].quantity) || 0;
      return {
        discount_amount: line.baseDiscount,
        tax_amounts: line.taxes.map((t) => t.amount),
        tax_amount_item:
          quantity > 0 ? round2(line.taxTotal / quantity) : line.taxTotal,
      };
    }),
    total_tax: retax.totalTax,
    total_base_discount: retax.totalBaseDiscount,
  };
}

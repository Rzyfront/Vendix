import { resolveLineTotals } from '../taxes/utils/tax-inclusive-math.util';
import {
  resolveLineTotal,
  resolvePriceUnits,
} from '../products/services/price-unit.util';
import { differsByAtLeastCents } from '@common/money-kernel';

/**
 * Impuesto de una línea de cotización resuelto en SERVIDOR (P1-1).
 *
 * Antes el modal calculaba `(precio × cantidad − descuento) × Σ tasas` y el
 * servidor lo guardaba tal cual: un producto con IVA 19 % INCLUIDO en $11.900
 * se cotizaba en $14.161 (el impuesto se sumaba dos veces), toda línea salía
 * rotulada «IVA» aunque fuera INC, y `convertToOrder` pasaba ese impuesto de
 * LÍNEA a `orders.create`, que lo lee POR UNIDAD de precio (ADR-08) y lo
 * multiplicaba otra vez por la cantidad en `order_item_taxes`.
 *
 * Semántica del precio de la línea (`unit_price` del DTO):
 *  - Precio de CATÁLOGO (coincide al centavo con un precio publicado del
 *    producto/variante/tarifa): se despeja con las tasas del producto tal como
 *    están asignadas — lo incluido NO crece el total, lo agregado suma sobre la
 *    base neta (misma función pura que POS/checkout/orders).
 *  - Precio MANUAL (no coincide con ninguno): regla del POS, precio manual =
 *    BRUTO DECLARADO — contiene todas las tasas de la línea, así que se despeja
 *    con `is_inclusive: true` para todas (`payments.service.ts`,
 *    `invertDeclaredGross`, ADR-01).
 *
 * El descuento de línea (`discount_amount`) reduce la BASE NETA gravable, como
 * hacía la cotización antes de este cambio: el impuesto va sobre la base ya
 * descontada.
 */

export interface QuotationLineRate {
  /** Fracción (0.19 = 19 %). */
  rate: number;
  is_inclusive: boolean;
  /** Tipo fiscal de la categoría (`iva`, `inc`, …); `null` en línea libre. */
  tax_type: string | null;
  name: string | null;
  tax_rate_id: number | null;
}

export interface QuotationLineInput {
  unit_price: number;
  quantity: number;
  discount_amount?: number | null;
  /** Escala de precio de la línea (`null`/1 = por unidad; presentación ⇒ null). */
  price_unit_quantity?: number | null;
}

export interface ResolvedQuotationLineTax {
  rate: number;
  is_inclusive: boolean;
  tax_type: string | null;
  name: string | null;
  tax_rate_id: number | null;
  /** Impuesto de esta tasa POR UNIDAD de precio. */
  unit_amount: number;
}

export interface ResolvedQuotationLine {
  /** Unidades de precio de la línea (cantidad / escala). */
  line_units: number;
  /** Base neta por unidad de precio, ANTES del descuento. */
  unit_base_price: number;
  /** Impuesto por unidad de precio (ADR-08), sobre la base ya descontada. */
  unit_tax_amount: number;
  /** Precio final por unidad (base + impuesto), antes del descuento. */
  unit_final_price: number;
  /** Base neta de la línea antes del descuento (`quotation_items.total_price`). */
  line_net_total: number;
  /** Impuesto total de la línea = `unit_tax_amount × line_units`. */
  line_tax_total: number;
  /** Σ de las fracciones (`quotation_items.tax_rate`). */
  tax_rate: number;
  taxes: ResolvedQuotationLineTax[];
  declared_gross: boolean;
}

const round2 = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;

/**
 * `true` si `price` coincide al centavo con alguno de los precios publicados.
 * Un candidato ausente, cero o negativo no cuenta.
 */
export function matchesCatalogPrice(
  price: number,
  candidates: Array<number | null | undefined>,
): boolean {
  return candidates.some(
    (candidate) =>
      candidate != null &&
      Number.isFinite(Number(candidate)) &&
      Number(candidate) > 0 &&
      !differsByAtLeastCents(price, Number(candidate)),
  );
}

export function resolveQuotationLine(
  line: QuotationLineInput,
  rates: QuotationLineRate[],
  options: { declared_gross: boolean },
): ResolvedQuotationLine {
  const unitPrice = Number(line.unit_price) || 0;
  const quantity = Number(line.quantity) || 0;
  const discount = Math.max(Number(line.discount_amount) || 0, 0);
  const lineUnits = resolvePriceUnits(quantity, line.price_unit_quantity);

  const solverRates = rates.map((r) => ({
    rate: r.rate,
    is_inclusive: options.declared_gross ? true : r.is_inclusive === true,
  }));
  const resolved = resolveLineTotals(unitPrice, solverRates);
  const unitBase = resolved.base;

  // Con descuento, el impuesto se recalcula sobre la base neta descontada:
  // todas las tasas ya son agregadas sobre esa base (la porción incluida se
  // despejó arriba), así que el kernel solo trunca `base × tasa`.
  let taxAmounts = resolved.taxes.map((t) => t.amount);
  if (discount > 0 && lineUnits > 0) {
    const discountedBase = Math.max(unitBase - discount / lineUnits, 0);
    const discounted = resolveLineTotals(
      discountedBase,
      rates.map((r) => ({ rate: r.rate, is_inclusive: false })),
    );
    taxAmounts = discounted.taxes.map((t) => t.amount);
  }
  const unitTax = round2(taxAmounts.reduce((sum, a) => sum + a, 0));

  return {
    line_units: lineUnits,
    unit_base_price: unitBase,
    unit_tax_amount: unitTax,
    unit_final_price: round2(unitBase + resolved.total_tax_amount),
    line_net_total: resolveLineTotal(unitBase, quantity, line.price_unit_quantity),
    line_tax_total: round2(unitTax * lineUnits),
    tax_rate: rates.reduce((sum, r) => sum + (Number(r.rate) || 0), 0),
    taxes: rates.map((r, index) => ({
      rate: r.rate,
      is_inclusive: r.is_inclusive,
      tax_type: r.tax_type,
      name: r.name,
      tax_rate_id: r.tax_rate_id,
      unit_amount: taxAmounts[index] ?? 0,
    })),
    declared_gross: options.declared_gross,
  };
}

/** Cabecera de la cotización: `grand = subtotal − descuentos + impuestos`. */
export function summarizeQuotationLines(
  lines: ResolvedQuotationLine[],
  discounts: Array<number | null | undefined>,
): {
  subtotal: number;
  discount: number;
  tax: number;
  grand_total: number;
} {
  const subtotal = round2(lines.reduce((s, l) => s + l.line_net_total, 0));
  const discount = round2(
    discounts.reduce<number>((s, d) => s + (Number(d) || 0), 0),
  );
  const tax = round2(lines.reduce((s, l) => s + l.line_tax_total, 0));
  return {
    subtotal,
    discount,
    tax,
    grand_total: round2(subtotal - discount + tax),
  };
}

import { resolveLineTotals } from '../../taxes/utils/tax-inclusive-math.util';
import { resolveLineUnits } from '../../taxes/utils/final-price.util';
import { toCents } from '@common/money-kernel';

/**
 * Impuesto de línea resuelto EN EL SERVIDOR para el carril de órdenes
 * (`OrdersService.create`, `updateOrderItems`, `updateOrderFromEditor`).
 *
 * Principio (auditoría de impuestos por producto, P0-1 / P0-4 / P1-2): el
 * servidor es la fuente de verdad del impuesto de cada línea según lo que el
 * CATÁLOGO asigna al producto — incluido (precio de góndola = bruto) o
 * agregado (base + impuesto). El cliente aporta el PRECIO (puede estar
 * negociado); nunca la clasificación ni el monto del impuesto.
 *
 * UN solo resolve por línea (`resolveLineTotals`, kernel único): la función
 * nunca aplica tasas sobre un valor que ya salió de otro resolve — ése es el
 * defecto de la orden 5928 (`reference_one_resolve_per_line_or_the_tax_compounds`)
 * y el de P0-1 (despejar un incluido sobre el NETO que mandó el cliente).
 *
 * Convención persistida (ADR-08): `unit_price` = BASE por unidad de precio,
 * `tax_amount_item` = impuesto POR UNIDAD de precio, `order_item_taxes`
 * = impuesto TOTAL de la línea (una fila por tasa, con `tax_type`).
 *
 * Cómo se elige el bruto (G) de partida, en orden de precedencia:
 *   1. Sin tasas: no hay impuesto (ADR-10: vender sin impuesto es válido).
 *      `unit_price` es la base.
 *   2. Sólo tasas AGREGADAS: `unit_price` ES la base (en todos los
 *      llamadores: POS/editor mandan el neto, reservas/cotizaciones el precio
 *      de góndola, que para un agregado coincide con la base). Se suma encima.
 *   3. Con alguna tasa INCLUIDA:
 *      a. `final_unit_price` explícito (editor, POS) ⇒ G = ese bruto.
 *      b. `unit_price` coincide (±1 ¢) con el precio de góndola del catálogo
 *         o con su base despejada ⇒ G = bruto de catálogo (reservas,
 *         cotizaciones, borrador de mostrador sin override).
 *      c. `total_price / unidades` supera a `unit_price` en ≥1 ¢ ⇒ el cliente
 *         mandó neto unitario + total bruto (borrador de mostrador) ⇒
 *         G = total / unidades.
 *      d. Ninguna señal ⇒ `unit_price` se toma como la BASE neta (contrato
 *         ADR-08 del DTO) y el impuesto se calcula ENCIMA, sin despejar: nunca
 *         se vuelve a despejar un incluido sobre un neto (P0-1).
 *      Con G conocido el despeje trata TODAS las tasas como incluidas dentro
 *      de G: devuelve la mayor base cuyo bruto ≤ G y las cuotas truncadas
 *      DIAN; cada fila conserva el `is_inclusive` REAL del catálogo.
 */

export interface ServerLineTaxRate {
  id: number;
  name: string;
  rate: unknown;
  is_compound?: boolean | null;
  tax_type?: string | null;
  is_inclusive: boolean;
}

export interface ServerLineTaxInput {
  unit_price: unknown;
  final_unit_price?: unknown;
  total_price?: unknown;
  quantity: unknown;
  weight?: unknown;
  price_unit_quantity?: unknown;
}

export type ServerLinePriceSource =
  | 'no_tax'
  | 'exclusive_base'
  | 'final_unit_price'
  | 'catalog_gross'
  | 'client_gross_total'
  | 'client_net';

export interface ServerLineTaxRow {
  tax_rate_id: number;
  tax_name: string;
  /** Fracción (0.19 = 19 %). */
  tax_rate: number;
  /** Impuesto TOTAL de la línea para esta tasa. */
  tax_amount: number;
  /** Nunca nulo: default canónico «sin tipar ⇒ IVA» sobre la fila fuente. */
  tax_type: string;
  is_compound: boolean;
  is_inclusive: boolean;
}

export interface ServerLineTaxResult {
  /** Base por unidad de precio. */
  unit_price: number;
  /** Impuesto por unidad de precio (Σ tasas). */
  tax_amount_item: number;
  /** Bruto por unidad de precio: base + impuesto. */
  final_unit_price: number;
  /** Base total de la línea (`unit_price × unidades`). */
  total_price: number;
  /** Impuesto total de la línea = Σ `taxes[].tax_amount`. */
  line_tax_total: number;
  /** Σ fracciones de las tasas (columna `order_items.tax_rate`). */
  tax_rate: number;
  line_units: number;
  source: ServerLinePriceSource;
  taxes: ServerLineTaxRow[];
}

const round2 = (value: number): number =>
  Number.isFinite(value) ? toCents(value) / 100 : 0;

const round5 = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * 100000) / 100000 : 0;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const sameCent = (a: number, b: number): boolean =>
  Math.abs(toCents(a) - toCents(b)) < 1;

/**
 * Resuelve base, impuesto por tasa y bruto de UNA línea con las tasas del
 * catálogo. Puro: sin DB, testeable sin mocks.
 *
 * @param catalogShelfPrice precio de góndola efectivo del catálogo (variante >
 *   producto, oferta incluida) — el `finalPrice` que el kernel espera. Sólo se
 *   usa como señal de desambiguación en el caso 3b.
 */
export function resolveServerLineTax(
  input: ServerLineTaxInput,
  rates: ServerLineTaxRate[] | null | undefined,
  catalogShelfPrice?: number | null,
): ServerLineTaxResult {
  const lineUnits = resolveLineUnits({
    quantity: input.quantity,
    weight: input.weight,
    price_unit_quantity: input.price_unit_quantity,
  });
  const unitPrice = round2(num(input.unit_price));
  const rows = (rates ?? []).filter((r) => r != null);

  if (rows.length === 0) {
    return {
      unit_price: unitPrice,
      tax_amount_item: 0,
      final_unit_price: unitPrice,
      total_price: round2(unitPrice * lineUnits),
      line_tax_total: 0,
      tax_rate: 0,
      line_units: lineUnits,
      source: 'no_tax',
      taxes: [],
    };
  }

  const fractions = rows.map((r) => {
    const f = num(r.rate);
    return f > 0 ? f : 0;
  });
  const hasInclusive = rows.some(
    (r, i) => r.is_inclusive === true && fractions[i] > 0,
  );

  let gross: number | null = null;
  let source: ServerLinePriceSource;
  if (!hasInclusive) {
    source = 'exclusive_base';
  } else {
    const explicitFinal = num(input.final_unit_price);
    const shelf = num(catalogShelfPrice);
    const catalog =
      shelf > 0
        ? resolveLineTotals(
            shelf,
            rows.map((r, i) => ({
              rate: fractions[i],
              is_inclusive: r.is_inclusive === true,
            })),
          )
        : null;
    const clientTotal = num(input.total_price);
    const grossFromTotal =
      lineUnits > 0 && clientTotal > 0 ? round2(clientTotal / lineUnits) : 0;

    if (explicitFinal > 0) {
      gross = round2(explicitFinal);
      source = 'final_unit_price';
    } else if (
      catalog &&
      (sameCent(unitPrice, shelf) || sameCent(unitPrice, catalog.base))
    ) {
      gross = round2(catalog.total);
      source = 'catalog_gross';
    } else if (grossFromTotal > 0 && toCents(grossFromTotal) - toCents(unitPrice) >= 1) {
      gross = grossFromTotal;
      source = 'client_gross_total';
    } else {
      source = 'client_net';
    }
  }

  const resolved =
    gross != null
      ? // G conocido: todas las tasas viven DENTRO de G (un solo despeje).
        resolveLineTotals(
          gross,
          fractions.map((rate) => ({ rate, is_inclusive: true })),
        )
      : // Base conocida: todas las tasas se suman ENCIMA (sin despejar).
        resolveLineTotals(
          unitPrice,
          fractions.map((rate) => ({ rate, is_inclusive: false })),
        );

  const base = round2(resolved.base);
  const taxes: ServerLineTaxRow[] = rows.map((r, i) => ({
    tax_rate_id: r.id,
    tax_name: r.name,
    tax_rate: round5(fractions[i]),
    tax_amount: round2(num(resolved.taxes[i]?.amount) * lineUnits),
    tax_type: r.tax_type ?? 'iva',
    is_compound: r.is_compound ?? false,
    is_inclusive: r.is_inclusive === true,
  }));
  const perUnitTax = round2(
    resolved.taxes.reduce((sum, t) => sum + num(t.amount), 0),
  );
  const lineTaxTotal = round2(taxes.reduce((sum, t) => sum + t.tax_amount, 0));

  return {
    unit_price: base,
    tax_amount_item: perUnitTax,
    final_unit_price: round2(base + perUnitTax),
    total_price: round2(base * lineUnits),
    line_tax_total: lineTaxTotal,
    tax_rate: round5(fractions.reduce((a, f) => a + f, 0)),
    line_units: lineUnits,
    source,
    taxes,
  };
}

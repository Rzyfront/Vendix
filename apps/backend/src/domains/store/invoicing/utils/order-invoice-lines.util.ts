import { Prisma } from '@prisma/client';
import { resolveOrderLineTaxTotal } from '../../taxes/utils/final-price.util';
import { resolveInclusiveClearing } from './dian-money.util';

/**
 * Proyección orden → líneas de factura cuando la base o el impuesto que la
 * orden persistió NO sirven tal cual para el documento fiscal.
 *
 * ## Los dos casos que cubre
 *
 * 1. **Descuento de ORDEN** (`orders.discount_amount`, P0-2). POS y checkout
 *    lo aplican DESPUÉS del impuesto (`grand_total = subtotal + tax −
 *    discount + envío`) y ninguna línea lo lleva: `order_items` no tiene
 *    columna de descuento. La factura lo perdía y declaraba el precio lleno.
 *    Regla (art. 454 ET — el descuento incondicional reduce la base): lo que
 *    pagó el cliente NO cambia. El descuento se reparte entre las líneas de
 *    producto en proporción a su BRUTO cobrado (base + impuesto), el centavo
 *    sobrante a la de mayor bruto, y cada línea se factura con
 *    `bruto − su parte`, despejando base y cuotas UNA vez con el kernel
 *    (`resolveInclusiveClearing`). El envío no recibe descuento.
 *
 * 2. **Impuesto de línea derivado por unidad** (P2-1). Los canales guardan la
 *    cuota por unidad × cantidad; con cantidades grandes esa suma se separa de
 *    `trunc(base de la línea × tarifa)` más allá de la tolerancia del XML
 *    (INC incluido 2.425 × 500 ⇒ 4,80 de diferencia, FAX07 rechaza). Si alguna
 *    fila difiere en MÁS de un centavo, la línea se re-despeja sobre su bruto
 *    total, una sola vez. Con un centavo o menos queda exactamente como hoy.
 *
 * ## Cómo se expresa en la factura
 *
 * La línea conserva `unit_price` y `quantity`; la base nueva va como
 * `discount_amount = total_price − base` (`cac:AllowanceCharge` de línea que
 * reduce `LineExtensionAmount`, el mecanismo que el builder UBL ya emite y que
 * `documentDiscount` descuenta de la cabecera para no duplicarlo). Por eso la
 * base nueva nunca puede superar `total_price`: si lo hiciera, la proyección no
 * aplica (drift) o falla cerrada (descuento).
 *
 * Una línea con impuesto escalar y SIN filas (`order_item_taxes`, F-090) no
 * tiene tarifa de la que despejar: no recibe descuento ni se re-despeja.
 */

export interface OrderInvoiceLineTaxRow {
  tax_rate_id?: unknown;
  tax_name: string;
  /** Fracción (`0.19`), como la guarda la orden. */
  tax_rate?: unknown;
  tax_amount?: unknown;
  tax_type?: unknown;
  is_inclusive?: unknown;
}

export interface OrderInvoiceLineSource {
  quantity?: unknown;
  total_price?: unknown;
  tax_amount_item?: unknown;
  weight?: unknown;
  price_unit_quantity?: unknown;
  order_item_taxes?: OrderInvoiceLineTaxRow[] | null;
}

export type OrderInvoiceLineReason =
  | 'unchanged'
  | 'order_discount'
  | 'line_tax_drift';

export interface ProjectedOrderInvoiceLine {
  reason: OrderInvoiceLineReason;
  /** Base gravable de la línea (neta del descuento proyectado). */
  base: Prisma.Decimal;
  /** `total_price − base`: el descuento de línea a declarar. */
  discount: Prisma.Decimal;
  /** Σ cuotas de la línea. */
  tax_total: Prisma.Decimal;
  /** Cuota por fila de `order_item_taxes`, mismo orden. */
  tax_amounts: Prisma.Decimal[];
  /** Parte del descuento de orden que absorbió la línea (bruto). */
  order_discount_share: Prisma.Decimal;
}

export type OrderInvoiceProjectionError =
  | { code: 'discount_exceeds_lines'; discount: string; eligible_gross: string }
  | { code: 'unclosed'; line_index: number; target: string }
  | { code: 'invalid_rate'; line_index: number; detail: string };

export interface OrderInvoiceProjection {
  lines: ProjectedOrderInvoiceLine[];
  /** Σ partes repartidas (= descuento de orden cuando no hay error). */
  allocated_discount: Prisma.Decimal;
  error?: OrderInvoiceProjectionError;
}

const ZERO = new Prisma.Decimal(0);
const CENT = new Prisma.Decimal('0.01');

const dec = (value: unknown): Prisma.Decimal => {
  const n = Number(value ?? 0);
  return new Prisma.Decimal(Number.isFinite(n) ? n : 0).toDecimalPlaces(2);
};
const fractionOf = (row: OrderInvoiceLineTaxRow): number => {
  const n = Number(row.tax_rate ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const truncCents = (value: Prisma.Decimal): Prisma.Decimal =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

interface Clearing {
  base: Prisma.Decimal;
  amounts: Prisma.Decimal[];
  residual_cents: number;
  invalid: string | null;
}

/** Despeje único del bruto de la línea contra TODAS sus tarifas. */
function clearLine(
  gross: Prisma.Decimal,
  rows: OrderInvoiceLineTaxRow[],
): Clearing {
  const taxed = rows.map(fractionOf);
  if (taxed.every((f) => f === 0)) {
    return {
      base: gross,
      amounts: rows.map(() => ZERO),
      residual_cents: 0,
      invalid: null,
    };
  }
  const result = resolveInclusiveClearing(
    gross.toFixed(2),
    taxed.map((fraction) => ({
      rate: fraction,
      rate_basis: 'fraction',
      is_inclusive: true,
    })),
  );
  return {
    base: new Prisma.Decimal(result.base),
    amounts: result.rates.map((r) => new Prisma.Decimal(r.amount)),
    residual_cents: result.unclosed_residual_cents,
    invalid: result.invalid_inputs.length
      ? result.invalid_inputs.map(String).join(',')
      : null,
  };
}

/**
 * Un bruto que la tarifa no alcanza (con IVA 19 % ~1 de cada 5 valores en
 * centavos: `b + trunc(0,19·b)` salta de a 2 ¢) deja el despeje UN centavo por
 * debajo. Ese centavo se declara en la cuota de la fila de mayor tarifa
 * (`trunc(base × r) + 0,01`): el prevalidador tolera 1 ¢ por fila
 * (`checkTaxSubtotals`) y FAX07 ±2,00, y así la línea factura EXACTO lo
 * cobrado. Con más de un centavo (varias tarifas en la línea) no se inventa
 * nada: el residuo sigue y el llamador decide.
 */
function absorbOneCent(cleared: Clearing, rows: OrderInvoiceLineTaxRow[]): Clearing {
  if (cleared.invalid || cleared.residual_cents !== 1) return cleared;
  let target = -1;
  rows.forEach((row, index) => {
    const fraction = fractionOf(row);
    if (fraction > 0 && (target < 0 || fraction > fractionOf(rows[target]))) {
      target = index;
    }
  });
  if (target < 0) return cleared;
  return {
    ...cleared,
    amounts: cleared.amounts.map((amount, index) =>
      index === target ? amount.plus(CENT) : amount,
    ),
    residual_cents: 0,
  };
}

/** ¿Alguna fila se separa más de un centavo de `trunc(base × tarifa)`? */
function drifts(base: Prisma.Decimal, rows: OrderInvoiceLineTaxRow[]): boolean {
  return rows.some((row) => {
    const fraction = fractionOf(row);
    if (fraction === 0) return false;
    const expected = truncCents(base.times(fraction));
    return dec(row.tax_amount).minus(expected).abs().greaterThan(CENT);
  });
}

export function projectOrderInvoiceLines(
  order_items: ReadonlyArray<OrderInvoiceLineSource> | null | undefined,
  order_discount_amount: unknown,
): OrderInvoiceProjection {
  const items = order_items ?? [];
  const unchanged = (item: OrderInvoiceLineSource): ProjectedOrderInvoiceLine => {
    const rows = item.order_item_taxes ?? [];
    return {
      reason: 'unchanged',
      base: dec(item.total_price),
      discount: ZERO,
      tax_total: dec(resolveOrderLineTaxTotal(item as any)),
      tax_amounts: rows.map((row) => dec(row.tax_amount)),
      order_discount_share: ZERO,
    };
  };
  const lines = items.map(unchanged);

  // --- Reparto del descuento de orden ---------------------------------------
  const discount = dec(order_discount_amount);
  const eligible = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const rows = item.order_item_taxes ?? [];
      // F-090: impuesto escalar sin filas ⇒ sin tarifa de la que despejar.
      return rows.length > 0 || Number(item.tax_amount_item ?? 0) === 0;
    })
    .map(({ item, index }) => ({
      index,
      gross: dec(item.total_price).plus(lines[index].tax_total),
    }))
    .filter((line) => line.gross.greaterThan(0));

  const shares = new Map<number, Prisma.Decimal>();
  if (discount.greaterThan(0)) {
    const eligible_gross = eligible.reduce((a, l) => a.plus(l.gross), ZERO);
    if (discount.greaterThan(eligible_gross)) {
      return {
        lines,
        allocated_discount: ZERO,
        error: {
          code: 'discount_exceeds_lines',
          discount: discount.toFixed(2),
          eligible_gross: eligible_gross.toFixed(2),
        },
      };
    }
    let allocated = ZERO;
    for (const line of eligible) {
      const share = truncCents(discount.times(line.gross).dividedBy(eligible_gross));
      shares.set(line.index, share);
      allocated = allocated.plus(share);
    }
    const largest = eligible.reduce((best, l) =>
      l.gross.greaterThan(best.gross) ? l : best,
    );
    shares.set(
      largest.index,
      (shares.get(largest.index) ?? ZERO).plus(discount.minus(allocated)),
    );
    if (shares.get(largest.index)!.greaterThan(largest.gross)) {
      return {
        lines,
        allocated_discount: ZERO,
        error: {
          code: 'discount_exceeds_lines',
          discount: discount.toFixed(2),
          eligible_gross: eligible_gross.toFixed(2),
        },
      };
    }
  }

  // Orden de despeje: la línea de mayor bruto al final, para que absorba los
  // centavos que una tarifa inalcanzable deja sin repartir en las anteriores.
  const ordered = [...eligible].sort((a, b) =>
    a.gross.comparedTo(b.gross),
  );
  let carry = ZERO;
  let allocated_discount = ZERO;
  for (const { index, gross } of ordered) {
    const item = items[index];
    const rows = item.order_item_taxes ?? [];
    const total_price = dec(item.total_price);
    const share = shares.get(index) ?? ZERO;

    // Descuento de orden (menos lo que la línea anterior ya tomó de más por
    // una tarifa inalcanzable). Una línea sin parte no hereda el arrastre.
    const applied = share.minus(carry);
    if (share.isZero() || applied.isNegative()) {
      // P2-1 — sin descuento: sólo si la cuota por unidad × cantidad deriva.
      if (!drifts(total_price, rows)) continue;
      const cleared = absorbOneCent(clearLine(gross, rows), rows);
      if (
        cleared.invalid ||
        cleared.residual_cents > 0 ||
        cleared.base.greaterThan(total_price)
      ) {
        continue; // no cierra al bruto cobrado: se queda como hoy
      }
      lines[index] = {
        reason: 'line_tax_drift',
        base: cleared.base,
        discount: total_price.minus(cleared.base),
        tax_total: cleared.amounts.reduce((a, b) => a.plus(b), ZERO),
        tax_amounts: cleared.amounts,
        order_discount_share: ZERO,
      };
      continue;
    }

    const target = gross.minus(applied);
    const cleared = absorbOneCent(clearLine(target, rows), rows);
    if (cleared.invalid) {
      return {
        lines,
        allocated_discount,
        error: { code: 'invalid_rate', line_index: index, detail: cleared.invalid },
      };
    }
    const residual = new Prisma.Decimal(cleared.residual_cents).dividedBy(100);
    const base = cleared.base;
    if (base.greaterThan(total_price) || base.isNegative()) {
      return {
        lines,
        allocated_discount,
        error: { code: 'unclosed', line_index: index, target: target.toFixed(2) },
      };
    }
    const line_share = applied.plus(residual);
    lines[index] = {
      reason: 'order_discount',
      base,
      discount: total_price.minus(base),
      tax_total: cleared.amounts.reduce((a, b) => a.plus(b), ZERO),
      tax_amounts: cleared.amounts,
      order_discount_share: line_share,
    };
    allocated_discount = allocated_discount.plus(line_share);
    carry = residual;
  }

  if (!carry.isZero()) {
    const last = ordered[ordered.length - 1];
    return {
      lines,
      allocated_discount,
      error: {
        code: 'unclosed',
        line_index: last?.index ?? -1,
        target: carry.toFixed(2),
      },
    };
  }

  return { lines, allocated_discount };
}

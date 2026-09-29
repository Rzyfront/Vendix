/**
 * Kernel compartido: aplica un descuento (cupón, promoción, manual) sobre la
 * BASE gravable de cada línea elegible (nunca sobre el bruto) y recalcula el
 * impuesto de línea sobre esa base ya descontada.
 *
 * Regla de negocio (owner, 2026-09-28): "un cupón descuenta sobre el valor
 * SIN impuesto y el impuesto se calcula sobre eso". Ver bug original: POS con
 * cupón 100% mostraba Impuestos > 0 porque el impuesto se sumaba PRE-descuento
 * y nunca se recalculaba.
 *
 * - PERCENTAGE: cada línea elegible reduce su base en el mismo % (idéntico en
 *   TOTAL a aplicar el % sobre el bruto, pero acá se calcula hacia ADELANTE:
 *   `base_descontada × tarifa`, nunca por clearing inverso).
 * - FIXED: el monto se prorratea por BASE (no por bruto) entre las líneas
 *   elegibles, tope la base elegible total. Esto es un CAMBIO DE COMPORTAMIENTO
 *   vs. hoy: antes el fijo se limitaba/aplicaba contra el bruto; ahora
 *   descuenta de la base y el bruto cae en `monto × (1 + tarifa)`.
 * - Cupón 100% ⇒ base 0, impuesto 0, total 0 (shipping/propina no se tocan,
 *   eso lo maneja el caller).
 *
 * Redondeo a centavo con método del mayor residuo (`distributeCents`) para
 * que Σ líneas cuadre exacto contra el total, igual criterio que
 * `payment-sale-share.util.ts` y `order-invoice-lines.util.ts`.
 */

export interface DiscountTaxRow {
  /** Fracción (0.19), no porcentaje. */
  rate: number;
  tax_type?: string | null;
  tax_rate_id?: number | null;
  tax_name?: string | null;
  is_inclusive?: boolean | null;
}

export interface DiscountableLine {
  /** Base gravable ANTES de descuento (`order_items.total_price` / POS `unitPrice*units`). */
  base: number;
  taxRows: DiscountTaxRow[];
  /** false ⇒ la línea no participa del reparto (fuera de alcance del cupón/promo). */
  eligible: boolean;
}

export type DiscountDescriptor =
  | { mode: 'percentage'; value: number } // 0-100
  | { mode: 'fixed'; amount: number };

export interface DiscountedLineTax {
  rate: number;
  tax_type?: string | null;
  tax_rate_id?: number | null;
  tax_name?: string | null;
  amount: number;
}

export interface DiscountedLine {
  base: number;
  baseDiscount: number;
  taxes: DiscountedLineTax[];
  taxTotal: number;
}

export interface OrderDiscountProjection {
  lines: DiscountedLine[];
  /** Σ base descontada de TODAS las líneas (para `orders.discount_amount`). */
  totalBaseDiscount: number;
  /** Σ impuesto post-descuento (para `orders.tax_amount`). */
  totalTax: number;
  /** Σ base post-descuento de TODAS las líneas. */
  totalBase: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Reparte `targetCents` (entero, céntimos) proporcional a `weights`; residuo a mayor fracción. */
function distributeCents(targetCents: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0 || targetCents <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (targetCents * w) / totalWeight);
  const floors = raw.map((r) => Math.floor(r));
  const assigned = floors.reduce((a, b) => a + b, 0);
  let remaining = targetCents - assigned;
  const order = raw
    .map((r, i) => ({ i, frac: r - floors[i], w: weights[i] }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w);
  const result = [...floors];
  for (let k = 0; k < order.length && remaining > 0; k++) {
    result[order[k].i] += 1;
    remaining--;
  }
  return result;
}

/**
 * Proyecta un descuento sobre un conjunto de líneas de orden, recalculando
 * impuesto de línea hacia adelante sobre la base ya descontada.
 *
 * Nota: para MÚLTIPLES descuentos acumulados (ej. promoción + cupón), llamar
 * esta función en cadena, usando `lines[].base` de salida como `base` de
 * entrada de la siguiente pasada (cada pasada reduce la base restante).
 */
export function projectOrderLineDiscount(
  lines: DiscountableLine[],
  discount: DiscountDescriptor,
): OrderDiscountProjection {
  const eligibleIdx = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.eligible && l.base > 0);
  const eligibleBaseTotal = round2(
    eligibleIdx.reduce((s, { l }) => s + l.base, 0),
  );

  const baseDiscountCentsByLine = new Array(lines.length).fill(0);

  if (eligibleBaseTotal > 0) {
    let targetCents: number;
    if (discount.mode === 'percentage') {
      const pct = Math.min(100, Math.max(0, discount.value)) / 100;
      targetCents = Math.round(eligibleBaseTotal * pct * 100);
    } else {
      const cappedAmount = Math.max(
        0,
        Math.min(discount.amount, eligibleBaseTotal),
      );
      targetCents = Math.round(cappedAmount * 100);
    }
    const shares = distributeCents(
      targetCents,
      eligibleIdx.map(({ l }) => l.base),
    );
    eligibleIdx.forEach(({ i }, k) => {
      baseDiscountCentsByLine[i] = shares[k];
    });
  }

  let totalBaseDiscount = 0;
  let totalTax = 0;
  let totalBase = 0;
  const outLines: DiscountedLine[] = lines.map((line, i) => {
    const baseDiscount = round2(baseDiscountCentsByLine[i] / 100);
    const newBase = round2(Math.max(0, line.base - baseDiscount));
    const taxes = line.taxRows.map((row) => ({
      rate: row.rate,
      tax_type: row.tax_type,
      tax_rate_id: row.tax_rate_id,
      tax_name: row.tax_name,
      amount: round2(newBase * (Number(row.rate) || 0)),
    }));
    const taxTotal = round2(taxes.reduce((a, b) => a + b.amount, 0));
    totalBaseDiscount = round2(totalBaseDiscount + baseDiscount);
    totalTax = round2(totalTax + taxTotal);
    totalBase = round2(totalBase + newBase);
    return { base: newBase, baseDiscount, taxes, taxTotal };
  });

  return { lines: outLines, totalBaseDiscount, totalTax, totalBase };
}

/**
 * Encadena varios descuentos (ej. promoción luego cupón) sobre el mismo
 * conjunto de líneas, aplicando cada uno sobre la base YA reducida por el
 * anterior. Devuelve la proyección final más el total base-discount
 * acumulado de todas las pasadas (para `orders.discount_amount`).
 */
/**
 * Variante para callers (POS `payments.service.ts`) que ya reciben el
 * descuento por línea en BRUTO — el motor de promociones
 * (`PromotionQuoteResult.items[].promotion_discount`) y el cupón (prorrateado
 * por el caller sobre el bruto restante, ver `distributeAmount`) trabajan en
 * bruto porque así se evalúa la elegibilidad/umbral (F-017, decisión de
 * negocio: cupón y umbral se miden contra el bruto que ve el cliente).
 *
 * Aun así el resultado es EXACTO respecto a la regla del owner: reducir el
 * bruto de una línea en una fracción `f` y reducir su base en esa MISMA
 * fracción `f` (con impuesto recalculado hacia adelante) son equivalentes,
 * porque `bruto = base × (1 + tarifa)` — la fracción conmuta. Por línea:
 * `fraction = min(1, descuento_bruto / bruto_original)`,
 * `nueva_base = base × (1 − fraction)`, impuesto recalculado por tasa.
 */
export interface GrossDiscountableLine {
  /** Base gravable ANTES de descuento. */
  base: number;
  /** `base + Σ impuesto de línea` ANTES de descuento. */
  grossOriginal: number;
  taxRows: DiscountTaxRow[];
}

export function applyGrossDiscountRetax(
  lines: GrossDiscountableLine[],
  grossDiscountByLine: number[],
): OrderDiscountProjection {
  let totalBaseDiscount = 0;
  let totalTax = 0;
  let totalBase = 0;
  const outLines: DiscountedLine[] = lines.map((line, i) => {
    const grossDiscount = Math.max(
      0,
      Math.min(grossDiscountByLine[i] || 0, line.grossOriginal),
    );
    const fraction =
      line.grossOriginal > 0 ? grossDiscount / line.grossOriginal : 0;
    const newBase = round2(Math.max(0, line.base * (1 - fraction)));
    const baseDiscount = round2(line.base - newBase);
    const taxes = line.taxRows.map((row) => ({
      rate: row.rate,
      tax_type: row.tax_type,
      tax_rate_id: row.tax_rate_id,
      tax_name: row.tax_name,
      amount: round2(newBase * (Number(row.rate) || 0)),
    }));
    const taxTotal = round2(taxes.reduce((a, b) => a + b.amount, 0));
    totalBaseDiscount = round2(totalBaseDiscount + baseDiscount);
    totalTax = round2(totalTax + taxTotal);
    totalBase = round2(totalBase + newBase);
    return { base: newBase, baseDiscount, taxes, taxTotal };
  });

  return { lines: outLines, totalBaseDiscount, totalTax, totalBase };
}

/**
 * Reparte `totalAmount` (moneda, 2 decimales) proporcional a `weights`,
 * cuadrando exacto a centavo (método del mayor residuo). Usado para
 * prorratear el monto AGREGADO de un cupón (sin desglose por línea) sobre el
 * bruto restante de cada línea tras la promoción.
 */
export function distributeAmount(
  totalAmount: number,
  weights: number[],
): number[] {
  const cents = Math.round((totalAmount + Number.EPSILON) * 100);
  return distributeCents(cents, weights).map((c) => round2(c / 100));
}

export function projectOrderLineDiscountsChain(
  lines: DiscountableLine[],
  discounts: DiscountDescriptor[],
): OrderDiscountProjection {
  let current: DiscountableLine[] = lines.map((l) => ({ ...l }));
  let accumulatedBaseDiscount = 0;
  let lastProjection: OrderDiscountProjection = {
    lines: current.map((l) => ({
      base: l.base,
      baseDiscount: 0,
      taxes: l.taxRows.map((row) => ({
        rate: row.rate,
        tax_type: row.tax_type,
        tax_rate_id: row.tax_rate_id,
        tax_name: row.tax_name,
        amount: round2(l.base * (Number(row.rate) || 0)),
      })),
      taxTotal: round2(
        l.taxRows.reduce(
          (s, row) => s + round2(l.base * (Number(row.rate) || 0)),
          0,
        ),
      ),
    })),
    totalBaseDiscount: 0,
    totalTax: round2(
      current.reduce(
        (sum, l) =>
          sum +
          l.taxRows.reduce(
            (s, row) => s + round2(l.base * (Number(row.rate) || 0)),
            0,
          ),
        0,
      ),
    ),
    totalBase: round2(current.reduce((s, l) => s + l.base, 0)),
  };

  for (const discount of discounts) {
    lastProjection = projectOrderLineDiscount(current, discount);
    accumulatedBaseDiscount = round2(
      accumulatedBaseDiscount + lastProjection.totalBaseDiscount,
    );
    current = current.map((l, i) => ({
      ...l,
      base: lastProjection.lines[i].base,
    }));
  }

  return { ...lastProjection, totalBaseDiscount: accumulatedBaseDiscount };
}

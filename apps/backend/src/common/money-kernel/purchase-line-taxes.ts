import { Decimal } from './decimal';

/**
 * Kernel puro de impuestos por línea de compra (POP) — QUI-855.
 * Sin Nest, sin Prisma, sin APIs de Node: compila también en Angular
 * (frontend vía alias `@money-kernel`).
 *
 * Cada monto de impuesto es LINEAL en la base neta `b` (a_i·b + c_i), por lo
 * que los impuestos incluidos se despejan en UN solo paso algebraico
 * (sin extraer uno a uno ni encadenar exclusivos sobre un bruto con impuesto).
 */

export type PurchaseTaxType = 'iva' | 'inc' | 'icui' | 'ibua';
export type PurchaseTaxCalcMode = 'percent' | 'fixed_per_unit';
export type PurchaseTaxBaseMode = 'net' | 'net_plus_prior';

export interface PurchaseLineTaxInput {
  tax_type: PurchaseTaxType;
  tax_rate_id?: number | null;
  tax_name?: string | null;
  calc_mode?: PurchaseTaxCalcMode;
  /** PORCENTAJE, ej. 19 = 19 %. */
  rate?: number | null;
  /** Pesos por unidad (fixed_per_unit). */
  fixed_amount_per_unit?: number | null;
  base_mode?: PurchaseTaxBaseMode;
  sequence?: number | null;
  is_inclusive?: boolean | null;
  add_to_cost?: boolean | null;
  /** Monto de línea impreso por el proveedor; reemplaza el calculado. */
  amount_override?: number | null;
}

export interface PurchaseLineInput {
  unit_price: number;
  quantity: number;
  /** Descuento TOTAL de la línea, en pesos, sobre el precio digitado. */
  discount_amount?: number;
  prices_include_tax: boolean;
  taxes: PurchaseLineTaxInput[];
}

export interface ResolvedPurchaseLineTax
  extends Required<Pick<PurchaseLineTaxInput, 'tax_type'>> {
  tax_rate_id: number | null;
  tax_name: string | null;
  calc_mode: PurchaseTaxCalcMode;
  rate: number | null;
  fixed_amount_per_unit: number | null;
  base_mode: PurchaseTaxBaseMode;
  sequence: number;
  is_inclusive: boolean;
  add_to_cost: boolean;
  taxable_amount: number;
  computed_amount: number;
  tax_amount: number;
  override_delta: number;
}

export interface ResolvedPurchaseLine {
  gross_line: number;
  net_total: number;
  net_unit: number;
  taxes: ResolvedPurchaseLineTax[];
  tax_total: number;
  capitalized_tax_total: number;
  non_capitalized_tax_total: number;
  inclusive_tax_total: number;
  exclusive_tax_total: number;
  line_total: number;
  cost_total: number;
  iva: ResolvedPurchaseLineTax | null;
}

export const PURCHASE_TAX_DEFAULT_SEQUENCE: Record<PurchaseTaxType, number> = {
  icui: 10,
  ibua: 10,
  inc: 20,
  iva: 30,
};

export const PURCHASE_TAX_ALWAYS_CAPITALIZED: ReadonlySet<PurchaseTaxType> =
  new Set<PurchaseTaxType>(['inc', 'icui', 'ibua']);

const INVALID = 'PURCHASE_TAX_INVALID_LINE';

function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function finite(n: unknown, fallback: number | null): number | null {
  if (n === null || n === undefined) return fallback;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(INVALID);
  return n;
}

interface Norm {
  tax_type: PurchaseTaxType;
  tax_rate_id: number | null;
  tax_name: string | null;
  calc_mode: PurchaseTaxCalcMode;
  rate: number | null;
  fixed: number | null;
  base_mode: PurchaseTaxBaseMode;
  sequence: number;
  is_inclusive: boolean;
  add_to_cost: boolean;
  override: number | null;
}

export function resolvePurchaseLineTaxes(
  line: PurchaseLineInput,
): ResolvedPurchaseLine {
  const unitPrice = finite(line.unit_price, null);
  const qtyN = finite(line.quantity, null);
  const discountN = finite(line.discount_amount, 0) as number;
  if (unitPrice === null || qtyN === null || qtyN <= 0) throw new Error(INVALID);
  const qty = new Decimal(qtyN);

  const gross = round2(new Decimal(unitPrice).times(qty).minus(discountN));
  if (gross.isNegative()) throw new Error(INVALID);

  // 1. Normalizar y ordenar de forma determinista.
  const norm: Norm[] = (line.taxes ?? []).map((t) => {
    const calc_mode: PurchaseTaxCalcMode =
      t.calc_mode ?? (t.tax_type === 'ibua' ? 'fixed_per_unit' : 'percent');
    const rate = finite(t.rate, null);
    const fixed = finite(t.fixed_amount_per_unit, null);
    if ((rate !== null && rate < 0) || (fixed !== null && fixed < 0)) {
      throw new Error(INVALID);
    }
    return {
      tax_type: t.tax_type,
      tax_rate_id: t.tax_rate_id ?? null,
      tax_name: t.tax_name ?? null,
      calc_mode,
      rate,
      fixed,
      base_mode: t.base_mode ?? 'net',
      sequence: finite(t.sequence, PURCHASE_TAX_DEFAULT_SEQUENCE[t.tax_type]) as number,
      is_inclusive: t.is_inclusive ?? line.prices_include_tax,
      add_to_cost: PURCHASE_TAX_ALWAYS_CAPITALIZED.has(t.tax_type)
        ? true
        : (t.add_to_cost ?? false),
      override: finite(t.amount_override, null),
    };
  });
  norm.sort(
    (x, y) =>
      x.sequence - y.sequence ||
      (x.tax_type < y.tax_type ? -1 : x.tax_type > y.tax_type ? 1 : 0) ||
      (x.rate ?? 0) - (y.rate ?? 0) ||
      (x.fixed ?? 0) - (y.fixed ?? 0) ||
      (x.tax_rate_id ?? 0) - (y.tax_rate_id ?? 0),
  );

  // 2. Coeficientes lineales: monto_i = a_i·b + c_i.
  const coef: { a: Decimal; c: Decimal }[] = [];
  let sumA = new Decimal(0);
  let sumC = new Decimal(0);
  for (const t of norm) {
    let a = new Decimal(0);
    let c = new Decimal(0);
    if (t.calc_mode === 'fixed_per_unit') {
      c = new Decimal(t.fixed ?? 0).times(qty);
    } else {
      const r = new Decimal(t.rate ?? 0).dividedBy(100);
      if (t.base_mode === 'net_plus_prior') {
        a = r.times(new Decimal(1).plus(sumA));
        c = r.times(sumC);
      } else {
        a = r;
      }
    }
    coef.push({ a, c });
    sumA = sumA.plus(a);
    sumC = sumC.plus(c);
  }

  // 3. Despejar la base neta en un solo paso.
  let inclA = new Decimal(0);
  let inclC = new Decimal(0);
  norm.forEach((t, i) => {
    if (t.is_inclusive) {
      inclA = inclA.plus(coef[i].a);
      inclC = inclC.plus(coef[i].c);
    }
  });
  const hasIncl = norm.some((t) => t.is_inclusive);
  const bExact = hasIncl
    ? gross.minus(inclC).dividedBy(new Decimal(1).plus(inclA))
    : gross;
  if (bExact.isNegative()) throw new Error(INVALID);

  // 4. Montos redondeados, override y ajuste de base por residuo.
  const computed = coef.map((k) => round2(k.a.times(bExact).plus(k.c)));
  const amounts = computed.map((cmp, i) =>
    norm[i].override !== null ? round2(new Decimal(norm[i].override as number)) : cmp,
  );
  let inclSum = new Decimal(0);
  amounts.forEach((m, i) => {
    if (norm[i].is_inclusive) inclSum = inclSum.plus(m);
  });
  const net = hasIncl ? gross.minus(inclSum) : gross;
  if (net.isNegative()) throw new Error(INVALID);

  let priorSum = new Decimal(0);
  const taxes: ResolvedPurchaseLineTax[] = norm.map((t, i) => {
    const isFixed = t.calc_mode === 'fixed_per_unit';
    const taxable =
      isFixed || t.base_mode === 'net' ? net : net.plus(priorSum);
    priorSum = priorSum.plus(amounts[i]);
    return {
      tax_type: t.tax_type,
      tax_rate_id: t.tax_rate_id,
      tax_name: t.tax_name,
      calc_mode: t.calc_mode,
      rate: t.rate,
      fixed_amount_per_unit: t.fixed,
      base_mode: t.base_mode,
      sequence: t.sequence,
      is_inclusive: t.is_inclusive,
      add_to_cost: t.add_to_cost,
      taxable_amount: taxable.toNumber(),
      computed_amount: computed[i].toNumber(),
      tax_amount: amounts[i].toNumber(),
      override_delta: amounts[i].minus(computed[i]).toNumber(),
    };
  });

  const sum = (pred: (t: ResolvedPurchaseLineTax) => boolean) =>
    taxes
      .filter(pred)
      .reduce((s, t) => s.plus(t.tax_amount), new Decimal(0));
  const taxTotal = sum(() => true);
  const capTotal = sum((t) => t.add_to_cost);

  return {
    gross_line: gross.toNumber(),
    net_total: net.toNumber(),
    net_unit: net.dividedBy(qty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
    taxes,
    tax_total: taxTotal.toNumber(),
    capitalized_tax_total: capTotal.toNumber(),
    non_capitalized_tax_total: taxTotal.minus(capTotal).toNumber(),
    inclusive_tax_total: sum((t) => t.is_inclusive).toNumber(),
    exclusive_tax_total: sum((t) => !t.is_inclusive).toNumber(),
    line_total: net.plus(taxTotal).toNumber(),
    cost_total: net.plus(capTotal).toNumber(),
    iva: taxes.find((t) => t.tax_type === 'iva') ?? null,
  };
}

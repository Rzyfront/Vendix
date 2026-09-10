import { Prisma } from '@prisma/client';

/**
 * Matemática pura del despeje impuesto-incluido (CP-impuesto-incluido-agregado, A.3).
 *
 * Replica la MISMA fórmula que `invoice-calculator.resolveTaxableBase` + el
 * truncado DIAN de `dian-money.util` (Anexo 1.9 §11.2: truncar, nunca redondear),
 * SIN importarlos: este helper vive en taxes y esos módulos viven en invoicing;
 * importarlos crearía un ciclo taxes ↔ invoicing. F-014 se cumple por paridad de
 * fórmula, no por compartir el símbolo — si la fórmula de factura cambia, esta
 * también debe cambiar (y viceversa).
 *
 * Semántica (ADR-02 con la corrección de F-005):
 * - Inclusivo NO crece el total: `B = G / (1 + Σ r_incl)` y cada cuota
 *   inclusiva sale de la base despejada. El redondeo es TRUNCADO DIAN, no
 *   residuo-a-la-mayor-tasa (F-005 corrige al ADR-02 en este punto).
 * - Agregado suma SOBRE LA BASE NETA despejada (idéntico a hoy cuando no hay
 *   inclusivo: `B = G` y `cuota = trunc(B × r)`).
 * - Mixto: primero se despeja lo inclusivo, lo agregado se suma encima.
 * - Con varias tasas inclusivas el divisor es la SUMA (no cascada): los
 *   tributos gravan la misma base, no impuesto-sobre-impuesto.
 *
 * F-011: el input `finalPrice` es el precio FINAL ya resuelto
 * (sale/tier/override). Nunca se despeja sobre `base_price` crudo: quien llama
 * resuelve primero y despeja después.
 */

const DIAN_SCALE = 2;
const TRUNCATE = Prisma.Decimal.ROUND_DOWN;
const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

/** Tasa tal como la lee cada canal: fracción decimal (0.19 = 19%). */
export interface TaxRateForResolution {
  rate: number;
  is_inclusive?: boolean | null;
}

/** Desglose por tasa: cuota truncada DIAN sobre la base neta despejada. */
export interface ResolvedTaxAmount {
  rate: number;
  is_inclusive: boolean;
  /** Base neta de la línea (la misma para todas las tasas). */
  base: number;
  /** Cuota de esta tasa, truncada a 2 decimales. */
  amount: number;
}

export interface ResolvedLineTotals {
  /** Base neta despejada (truncada DIAN). */
  base: number;
  /**
   * Total a cobrar: precio publicado + SOLO lo agregado.
   * Con todo inclusivo, `total === finalPrice` (el total no crece).
   */
  total: number;
  /** Σ de todas las tasas (significado legacy, se conserva por compatibilidad). */
  total_rate: number;
  /** Σ de todas las cuotas (inclusivas despejadas + agregadas). */
  total_tax_amount: number;
  inclusive_tax_amount: number;
  exclusive_tax_amount: number;
  taxes: ResolvedTaxAmount[];
}

/**
 * Truncado monetario DIAN (Anexo 1.9 §11.2): hacia cero, 2 decimales.
 * `truncMoney(100.005) === 100`, nunca `100.01`.
 */
export function truncMoney(value: number): number {
  return toNum(truncate(toDecimal(value)));
}

/**
 * Dueño único del despeje (F-003): checkout/POS/orders/vitrina consumen esta
 * semántica en vez de reimplementarla. Puro y síncrono a propósito: sin DB,
 * testeable sin mocks.
 */
export function resolveLineTotals(
  finalPrice: number,
  ratesInput?: TaxRateForResolution[] | null,
): ResolvedLineTotals {
  const gross = toDecimal(finalPrice);
  const rates = (ratesInput ?? []).map((r) => ({
    rate: sanitizeRate(r?.rate),
    is_inclusive: r?.is_inclusive === true,
  }));

  let inclusiveRateSum = ZERO;
  for (const r of rates) {
    if (r.is_inclusive) inclusiveRateSum = inclusiveRateSum.plus(r.rate);
  }

  const divisor = ONE.plus(inclusiveRateSum);
  // Divisor ≤ 0 solo llegaría con tarifas negativas (el DTO las prohíbe):
  // se degrada a "sin despeje" en vez de emitir base negativa o infinita.
  const baseExact =
    rates.some((r) => r.is_inclusive) && divisor.greaterThan(ZERO)
      ? gross.dividedBy(divisor)
      : gross;
  // La base gravable nunca es negativa (espejo de invoice-calculator).
  const base = truncate(baseExact.isNegative() ? ZERO : baseExact);
  const baseNum = toNum(base);

  const taxes: ResolvedTaxAmount[] = rates.map((r) => ({
    rate: r.rate,
    is_inclusive: r.is_inclusive,
    base: baseNum,
    amount: toNum(truncate(base.times(r.rate))),
  }));

  let inclusiveTax = ZERO;
  let exclusiveTax = ZERO;
  for (const t of taxes) {
    const amount = toDecimal(t.amount);
    if (t.is_inclusive) inclusiveTax = inclusiveTax.plus(amount);
    else exclusiveTax = exclusiveTax.plus(amount);
  }

  const totalRate = rates.reduce((sum, r) => sum + r.rate, 0);

  return {
    base: baseNum,
    total: toNum(gross.plus(exclusiveTax)),
    total_rate: totalRate,
    total_tax_amount: toNum(inclusiveTax.plus(exclusiveTax)),
    inclusive_tax_amount: toNum(inclusiveTax),
    exclusive_tax_amount: toNum(exclusiveTax),
    taxes,
  };
}

function sanitizeRate(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toDecimal(value: unknown): Prisma.Decimal {
  const n = Number(value);
  if (!Number.isFinite(n)) return ZERO;
  try {
    return new Prisma.Decimal(n);
  } catch {
    return ZERO;
  }
}

function truncate(d: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(d.toFixed(DIAN_SCALE, TRUNCATE));
}

function toNum(d: Prisma.Decimal): number {
  const n = d.toNumber();
  // Truncar un negativo ínfimo da -0: se normaliza (igual que dian-money).
  return Object.is(n, -0) ? 0 : n;
}

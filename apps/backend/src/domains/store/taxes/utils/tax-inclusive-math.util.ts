import { Prisma } from '@prisma/client';
import {
  INCLUSIVE_SOLVER_MAX_STEPS,
  resolveInclusiveClearing,
} from '../../invoicing/utils/dian-money.util';
import type { InclusiveRateBasis } from '../../invoicing/utils/dian-money.util';

/**
 * Espejo DELGADO del despeje impuesto-incluido (A.2, F-001/ADR-01).
 *
 * `resolveLineTotals` NO implementa el loop: delega en el kernel único
 * `resolveInclusiveClearing` (`invoicing/utils/dian-money.util.ts`, hoja sin
 * imports de dominio — por eso no hay ciclo taxes ↔ invoicing) y solo adapta
 * `Decimal → number`. Misma cota, mismas precondiciones, mismo cierre en
 * centavos y misma semántica de carve-outs donde aplica:
 * - Base propia / AIU-contrato / `omit_tax_total`: carve-outs DEL MOTOR. El
 *   espejo no los recibe en su forma de entrada (tasas sin base propia), así
 *   que no hay nada que espejar; documentado, no ignorado en silencio.
 * - `rate_basis`: SÍ aplica — se normaliza con el `toFraction` compartido
 *   del kernel (F-032). Ausente ⇒ `fraction` (cero regresión: todos los
 *   llamadores actuales ya mandan fracción).
 * - `is_inclusive`: estricto `=== true` (F-035), igual que el kernel.
 *
 * La aserción de cota vive DENTRO del kernel (camino puro): la fachada
 * `TaxesService.resolveLineTotals` y los importadores directos la heredan
 * por delegación (F-004). La cota se re-exporta para visibilidad sin tocar
 * la fachada.
 *
 * Semántica (ADR-02 con la corrección de F-005 + cierre A.2/ADR-01):
 * - Inclusivo NO crece el total: `B = G / (1 + Σ r_incl)` con bump acotado
 *   de a 1¢ hasta la mayor base con `f(base) ≤ bruto`; cada cuota sale de la
 *   base final con TRUNCADO DIAN (Anexo 1.9 §11.2), nunca residuo-a-la-mayor.
 * - Agregado suma SOBRE LA BASE NETA despejada (idéntico a hoy sin
 *   inclusivo: `B = G` y `cuota = trunc(B × r)`).
 * - Con varias tasas inclusivas el divisor es la SUMA (no cascada).
 * - Inalcanzable (el escalón salta el bruto) ⇒ closest-below + residuo
 *   declarado en `unclosed_residual_cents` (ADR-04, jamás overshoot).
 * - Inválidos ⇒ coerción por compat + reporte en `invalid_inputs` (F-062).
 *
 * F-011: el input `finalPrice` es el precio FINAL ya resuelto
 * (sale/tier/override). Nunca se despeja sobre `base_price` crudo: quien llama
 * resuelve primero y despeja después.
 */

export { INCLUSIVE_SOLVER_MAX_STEPS };
export type { InclusiveRateBasis };

const ZERO = new Prisma.Decimal(0);

/** Tasa tal como la lee cada canal + unidad declarada (F-032). */
export interface TaxRateForResolution {
  rate: number;
  is_inclusive?: boolean | null;
  /**
   * Unidad de `rate`. Ausente ⇒ `fraction` (0.19 = 19%, igual que
   * `tax_rates.rate` y `calculateProductTaxes`). `percent` (19 ⇒ 0.19) y
   * `per_mil`/`per-mil` (9.66 ⇒ 0.00966) se normalizan con el `toFraction`
   * del kernel; basis desconocida ⇒ inválido + fracción 0.
   */
  rate_basis?: InclusiveRateBasis;
}

/** Desglose por tasa: cuota truncada DIAN sobre la base neta despejada. */
export interface ResolvedTaxAmount {
  /** Fracción normalizada (0.19 = 19%), no el crudo de entrada. */
  rate: number;
  is_inclusive: boolean;
  /** Base neta de la línea (la misma para todas las tasas). */
  base: number;
  /** Cuota de esta tasa, truncada a 2 decimales. */
  amount: number;
}

export interface ResolvedLineTotals {
  /** Base neta despejada (truncada DIAN, con el bump absorbido). */
  base: number;
  /**
   * Total a cobrar: `f(base_final) + Σ agregadas`. Con cierre exacto y todo
   * inclusivo, `total === finalPrice`; inalcanzable ⇒ closest-below (≤ bruto).
   */
  total: number;
  /** Σ de las fracciones normalizadas (significado legacy, se conserva). */
  total_rate: number;
  /** Σ de todas las cuotas (inclusivas despejadas + agregadas). */
  total_tax_amount: number;
  inclusive_tax_amount: number;
  exclusive_tax_amount: number;
  taxes: ResolvedTaxAmount[];
  /**
   * Residuo inalcanzable en centavos (F-061/ADR-04): 0 si cierra. Quien
   * persiste (checkout/storefront/payments) lo chequea ANTES de persistir.
   */
  unclosed_residual_cents: number;
  /** Entradas coercionadas por compat (F-062): bruto/tasas/basis en crudo. */
  invalid_inputs: unknown[];
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
 * testeable sin mocks. Llamada delgada al kernel (F-001): todo el loop vive
 * en `dian-money.util.ts`.
 */
export function resolveLineTotals(
  finalPrice: number,
  ratesInput?: TaxRateForResolution[] | null,
): ResolvedLineTotals {
  const solved = resolveInclusiveClearing(
    finalPrice,
    (ratesInput ?? []).map((r) => ({
      rate: r?.rate,
      is_inclusive: r?.is_inclusive,
      rate_basis: r?.rate_basis,
    })),
  );

  const baseNum = toNum(solved.base);
  const taxes: ResolvedTaxAmount[] = solved.rates.map((t) => ({
    rate: toNum(t.fraction),
    is_inclusive: t.is_inclusive,
    base: baseNum,
    amount: toNum(t.amount),
  }));

  let inclusiveTax = ZERO;
  let exclusiveTax = ZERO;
  let totalRate = ZERO;
  for (const t of solved.rates) {
    totalRate = totalRate.plus(t.fraction);
    if (t.is_inclusive) inclusiveTax = inclusiveTax.plus(t.amount);
    else exclusiveTax = exclusiveTax.plus(t.amount);
  }

  return {
    base: baseNum,
    total: toNum(solved.total),
    total_rate: toNum(totalRate),
    total_tax_amount: toNum(inclusiveTax.plus(exclusiveTax)),
    inclusive_tax_amount: toNum(inclusiveTax),
    exclusive_tax_amount: toNum(exclusiveTax),
    taxes,
    unclosed_residual_cents: solved.unclosed_residual_cents,
    invalid_inputs: solved.invalid_inputs,
  };
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
  return new Prisma.Decimal(d.toFixed(2, Prisma.Decimal.ROUND_DOWN));
}

function toNum(d: Prisma.Decimal): number {
  const n = d.toNumber();
  // Truncar un negativo ínfimo da -0: se normaliza (igual que dian-money).
  return Object.is(n, -0) ? 0 : n;
}

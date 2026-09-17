import { Prisma } from '@prisma/client';
import * as Kernel from '@common/money-kernel';
import type {
  DianNumericInput,
  DianLineAmounts,
  DianClearedLineAmounts,
  AbsorbRateBasis,
  AbsorbKernelRateInput,
  AbsorbKernelLineInput,
  InclusiveRateBasis,
  InclusiveSolveRateInput,
  Decimal as KernelDecimal,
} from '@common/money-kernel';

/**
 * Canonical monetary/rate formatting for every DIAN artifact.
 *
 * ADR-16 (CP-pos-exclusive-tax-double-charge): la ARITMÉTICA ya no vive acá.
 * Este archivo es una fachada sobre `@common/money-kernel` — el kernel único
 * que también consume (o consumirá) `apps/frontend`, portado verbatim desde
 * este mismo archivo salvo un cambio: donde el código histórico usaba
 * `Prisma.Decimal` directo, el kernel usa su propio constructor `Decimal`
 * (`@common/money-kernel`, `./decimal.ts`), clonado con la MISMA
 * configuración exacta de `Prisma.Decimal` (precision 20, rounding
 * ROUND_HALF_UP, toExpNeg -7, toExpPos 21, modulo DOWN — `Prisma.Decimal` es
 * `decimal.js` por dentro, sin overrides propios).
 *
 * Los ~30 importadores de este archivo (checkout, invoicing, payments,
 * products, cufe-calculator, ubl-*, ecommerce/table-sessions, etc.) NO
 * cambian: siguen importando desde esta misma ruta, con los mismos nombres.
 *
 * POR QUÉ ESTO NO ES UN `export * from '@common/money-kernel'` DIRECTO —
 * el defecto que cierra esta fachada:
 *
 * El kernel corre en SU PROPIO constructor `Decimal` (clonado, no
 * `Prisma.Decimal`). `Decimal.isDecimal()` (dentro del kernel) reconoce por
 * igual instancias de ambos constructores porque los dos son `decimal.js` —
 * eso resuelve el INPUT: cualquier `Prisma.Decimal` que ya circula por el
 * dominio (columnas `invoice_taxes.tax_rate`, `products.cost_price`, etc.)
 * sigue siendo aceptado sin cambios. Pero NO resuelve el OUTPUT: un
 * `value instanceof Prisma.Decimal` sobre lo que el kernel devuelve da
 * `false`, porque `instanceof` compara identidad de constructor, no forma —
 * y `dian-money-absorb-kernel.spec.ts` (uno de los ~30 importadores, fuera
 * de alcance de este encargo) hace exactamente ese chequeo sobre
 * `absorbInclusiveLine(...).base` y `.quotas[i].quota`. Las funciones que
 * SÓLO devuelven `string`/`boolean` (`dianAmount`, `dianSum`,
 * `clearInclusiveLine`, `isStrictFiniteInput`, …) no tienen este problema y
 * se re-exportan tal cual; las que devuelven `Decimal` en el resultado
 * (`toDecimal`, `absorbRateToFraction`, `absorbPriceUnitDivisor`,
 * `toFraction`, `absorbInclusiveLine`, `resolveInclusiveClearing`) se
 * envuelven acá para reconstruir un `Prisma.Decimal` real a partir del
 * `Decimal` del kernel antes de devolverlo — `new Prisma.Decimal(kernel.toString())`
 * es exacta y sin pérdida porque ambos constructores comparten
 * `toExpNeg`/`toExpPos`/`precision` (mismo `.toString()` por construcción).
 *
 * @see docs/facturacion-electronica-dian-software-propio.md §20.0-bis
 * @see docs/critical-plans/CP-pos-exclusive-tax-double-charge/adr/ADR-16-un-solo-kernel-de-dinero-compartido-prob.md
 */

export type {
  DianNumericInput,
  DianLineAmounts,
  DianClearedLineAmounts,
  AbsorbRateBasis,
  AbsorbKernelRateInput,
  AbsorbKernelLineInput,
  InclusiveRateBasis,
  InclusiveSolveRateInput,
};

export {
  INCLUSIVE_ABSORB_KERNEL_VERSION,
  INCLUSIVE_ABSORB_MAX_STEPS,
  INCLUSIVE_SOLVER_MAX_STEPS,
  dianAmount,
  dianUnitPrice,
  dianRate,
  dianSum,
  dianArithmetic,
  dianLineExtension,
  dianLineGross,
  dianPriceAmount,
  dianLineExtensionTotal,
  clearInclusiveLine,
  isStrictFiniteInput,
  coerceInclusiveStrict,
  isInclusiveRateBasis,
} from '@common/money-kernel';

/** Reconstruye un `Prisma.Decimal` real a partir del `Decimal` del kernel. */
function toPrismaDecimal(value: KernelDecimal): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

/** Ver {@link Kernel.AbsorbKernelQuota} — misma forma, `Decimal` ⇒ `Prisma.Decimal`. */
export interface AbsorbKernelQuota {
  fraction: Prisma.Decimal;
  rate_basis: AbsorbRateBasis;
  tax_type: string;
  is_inclusive: boolean;
  quota: Prisma.Decimal;
}

/** Ver {@link Kernel.AbsorbKernelResult} — misma forma, `Decimal` ⇒ `Prisma.Decimal`. */
export interface AbsorbKernelResult {
  kernel: typeof Kernel.INCLUSIVE_ABSORB_KERNEL_VERSION;
  gross: Prisma.Decimal;
  base: Prisma.Decimal;
  quotas: AbsorbKernelQuota[];
  closed_total: Prisma.Decimal;
  residual_absorbed_cents: number;
  unclosed_residual_cents: number;
  closed_exactly: boolean;
  steps: number;
  capped: boolean;
  searched: boolean;
  invalid_inputs: string[];
}

/** Ver {@link Kernel.InclusiveSolvedRate} — misma forma, `Decimal` ⇒ `Prisma.Decimal`. */
export interface InclusiveSolvedRate {
  fraction: Prisma.Decimal;
  is_inclusive: boolean;
  has_fixed_base: boolean;
  amount: Prisma.Decimal;
}

/** Ver {@link Kernel.InclusiveClearingResult} — misma forma, `Decimal` ⇒ `Prisma.Decimal`. */
export interface InclusiveClearingResult {
  base: Prisma.Decimal;
  rates: InclusiveSolvedRate[];
  total: Prisma.Decimal;
  unclosed_residual_cents: number;
  invalid_inputs: unknown[];
  iterations: number;
}

/**
 * Parses any accepted input into a `Prisma.Decimal`. Delega la aritmética en
 * el kernel y reconstruye el `Prisma.Decimal` al volver (ver nota de cabecera).
 */
export function toDecimal(value: DianNumericInput | unknown): Prisma.Decimal {
  return toPrismaDecimal(Kernel.toDecimal(value));
}

/** Ver {@link Kernel.absorbRateToFraction}. Misma firma; `fraction` vuelve como `Prisma.Decimal`. */
export function absorbRateToFraction(
  rate: DianNumericInput | unknown,
  rate_basis: unknown,
  defaultBasis: AbsorbRateBasis = 'percent',
): { fraction: Prisma.Decimal; basis: AbsorbRateBasis; invalid: string | null } {
  const result = Kernel.absorbRateToFraction(rate, rate_basis, defaultBasis);
  return {
    fraction: toPrismaDecimal(result.fraction),
    basis: result.basis,
    invalid: result.invalid,
  };
}

/** Ver {@link Kernel.absorbPriceUnitDivisor}. Misma firma; retorna `Prisma.Decimal`. */
export function absorbPriceUnitDivisor(
  value: DianNumericInput,
  invalid_inputs: string[],
): Prisma.Decimal {
  return toPrismaDecimal(Kernel.absorbPriceUnitDivisor(value, invalid_inputs));
}

/**
 * Ver {@link Kernel.toFraction}.
 *
 * @deprecated F-067: la normalización única vive en `absorbRateToFraction`
 * (con default explícito por camino + reporte). Esta función se conserva por
 * compatibilidad; no la uses en código nuevo.
 */
export function toFraction(rate: unknown, basis?: unknown): Prisma.Decimal {
  return toPrismaDecimal(Kernel.toFraction(rate, basis));
}

/**
 * Ver {@link Kernel.absorbInclusiveLine} (sección "Inclusive absorb kernel"
 * del kernel). Misma firma y semántica; los campos `Decimal` del resultado
 * vuelven como `Prisma.Decimal` (ver nota de cabecera de este archivo).
 */
export function absorbInclusiveLine(input: AbsorbKernelLineInput): AbsorbKernelResult {
  const result = Kernel.absorbInclusiveLine(input);
  return {
    ...result,
    gross: toPrismaDecimal(result.gross),
    base: toPrismaDecimal(result.base),
    closed_total: toPrismaDecimal(result.closed_total),
    quotas: result.quotas.map((q) => ({
      ...q,
      fraction: toPrismaDecimal(q.fraction),
      quota: toPrismaDecimal(q.quota),
    })),
  };
}

/**
 * Ver {@link Kernel.resolveInclusiveClearing} (sección "A.2 inclusive
 * solver" del kernel). Misma firma y semántica; los campos `Decimal` del
 * resultado vuelven como `Prisma.Decimal` (ver nota de cabecera).
 */
export function resolveInclusiveClearing(
  gross: unknown,
  ratesInput: ReadonlyArray<InclusiveSolveRateInput> | null | undefined,
): InclusiveClearingResult {
  const result = Kernel.resolveInclusiveClearing(gross, ratesInput);
  return {
    ...result,
    base: toPrismaDecimal(result.base),
    total: toPrismaDecimal(result.total),
    rates: result.rates.map((r) => ({
      ...r,
      fraction: toPrismaDecimal(r.fraction),
      amount: toPrismaDecimal(r.amount),
    })),
  };
}

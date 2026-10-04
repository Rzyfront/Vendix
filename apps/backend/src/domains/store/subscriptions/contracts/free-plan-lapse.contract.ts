import { Prisma } from '@prisma/client';

/**
 * FREE PLAN LAPSE CONTRACT — única definición de "un plan gratis que caduca".
 *
 * Regla de negocio: un plan de precio efectivo 0 (sin margen de partner) que es
 * promocional O tiene `auto_renew=false` NO se renueva al terminar su periodo:
 * la suscripción pasa a `expired` sin gracia ni dunning. Un plan gratis base con
 * `auto_renew=true` (p. ej. core-free) sí sigue avanzando de periodo.
 *
 * Lo comparten el cron de facturación (que no debe avanzar el periodo) y el
 * motor de estados (que debe expirar la suscripción).
 */
export const FREE_PLAN_LAPSE_REASON = 'free_plan_period_ended' as const;

export interface FreePlanLapseInput {
  effectivePrice: Prisma.Decimal | number | string | null | undefined;
  marginAmount?: Prisma.Decimal | number | string | null;
  isPromotional: boolean | null | undefined;
  autoRenew: boolean | null | undefined;
}

/** true ⇔ precio efectivo <= 0 Y margen <= 0 (o ausente) Y (isPromotional === true || autoRenew === false). */
export function shouldLapseFreePlanAtPeriodEnd(
  input: FreePlanLapseInput,
): boolean {
  if (input.effectivePrice === null || input.effectivePrice === undefined) {
    return false;
  }
  const zero = new Prisma.Decimal(0);
  if (new Prisma.Decimal(input.effectivePrice).greaterThan(zero)) return false;
  if (
    input.marginAmount !== null &&
    input.marginAmount !== undefined &&
    new Prisma.Decimal(input.marginAmount).greaterThan(zero)
  ) {
    return false;
  }
  return input.isPromotional === true || input.autoRenew === false;
}

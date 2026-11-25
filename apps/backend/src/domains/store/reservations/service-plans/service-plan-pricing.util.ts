import { addDaysToDateString } from '@common/utils/schedule-window.util';

/**
 * QUI-1060 modo Plan: reglas puras (sin base de datos) de un plan de varios días.
 * El servicio y la reserva las usan para que precio, regreso y tramos salgan de
 * una sola definición.
 */

/** Tramo de precio del paquete según tamaño del grupo (pax totales). */
export interface PlanPaxTier {
  min_pax: number;
  max_pax: number;
  price: number;
}

/** Campos del producto que deciden si es un plan de varios días. */
export interface PlanProductFields {
  service_pricing_type?: string | null;
  plan_duration_days?: number | null;
}

/**
 * Modo Plan = servicio con precio tipo paquete y duración en días. Cualquier otro
 * servicio (por horas, por sesión, paquete sin días) sigue el flujo actual.
 */
export function isPlanProduct(product: PlanProductFields | null | undefined): boolean {
  return (
    product?.service_pricing_type === 'package' &&
    typeof product.plan_duration_days === 'number' &&
    product.plan_duration_days >= 1
  );
}

/** Fecha de regreso (`YYYY-MM-DD`): salida + días − 1. Un plan de 1 día regresa el mismo día. */
export function planReturnDate(startDate: string, durationDays: number): string {
  return addDaysToDateString(startDate.slice(0, 10), Math.max(durationDays, 1) - 1);
}

/** Primer par de tramos que se solapan (por índice original), o null si no hay solape. */
export function findOverlappingTiers(tiers: readonly PlanPaxTier[]): [number, number] | null {
  const ordered = tiers
    .map((tier, index) => ({ tier, index }))
    .sort((a, b) => a.tier.min_pax - b.tier.min_pax || a.tier.max_pax - b.tier.max_pax);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].tier.min_pax <= ordered[i - 1].tier.max_pax) {
      return [ordered[i - 1].index, ordered[i].index];
    }
  }
  return null;
}

export type PlanPriceResolution =
  | { ok: true; price: number; source: 'tier' | 'departure_override'; tier: PlanPaxTier | null }
  | { ok: false; reason: 'no_pax' | 'below_min' | 'above_max' | 'no_tier' };

/**
 * Precio del paquete para un grupo. Cuentan adultos + niños (la regla de niños no
 * está definida: todos ocupan cupo y tramo). El override de la salida, si existe,
 * reemplaza al tramo; el grupo igual debe caber en el mínimo/máximo del plan.
 */
export function resolvePlanPrice(args: {
  tiers: readonly PlanPaxTier[];
  totalPax: number;
  minPax?: number | null;
  maxPax?: number | null;
  departureOverride?: number | null;
}): PlanPriceResolution {
  const { tiers, totalPax, minPax, maxPax, departureOverride } = args;
  if (!Number.isInteger(totalPax) || totalPax < 1) return { ok: false, reason: 'no_pax' };
  if (minPax != null && totalPax < minPax) return { ok: false, reason: 'below_min' };
  if (maxPax != null && totalPax > maxPax) return { ok: false, reason: 'above_max' };
  if (departureOverride != null) {
    return { ok: true, price: Number(departureOverride), source: 'departure_override', tier: null };
  }
  const tier = tiers.find((t) => totalPax >= t.min_pax && totalPax <= t.max_pax);
  if (!tier) return { ok: false, reason: 'no_tier' };
  return { ok: true, price: Number(tier.price), source: 'tier', tier };
}

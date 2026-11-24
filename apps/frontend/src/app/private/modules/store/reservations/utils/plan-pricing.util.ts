/**
 * Pure helpers for "Plan / paquete" services (QUI-1060). The backend is the
 * authority for price and seats; these only drive what the reservation modal shows.
 */

export interface PlanPaxTier {
  min_pax: number;
  max_pax: number;
  price: number;
}

export type PlanPriceFailure = 'no_tier' | 'below_min' | 'above_max' | 'no_pax';

export type PlanPriceResult =
  | { ok: true; price: number; source: 'tier' | 'departure_override' }
  | { ok: false; reason: PlanPriceFailure };

export interface PlanPriceInput {
  tiers: readonly PlanPaxTier[];
  adults: number;
  children: number;
  departureOverride?: number | null;
  minPax?: number | null;
  maxPax?: number | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Return date of a plan: start + days - 1 (1 day => same date).
 * Pure UTC calendar arithmetic over 'YYYY-MM-DD'; no timezone shift.
 */
export function computePlanReturnDate(startDate: string, days: number): string {
  const [y, m, d] = startDate.split('-').map(Number);
  if (!y || !m || !d || !Number.isFinite(days) || days < 1) return startDate;
  const start = Date.UTC(y, m - 1, d);
  const end = new Date(start + (Math.floor(days) - 1) * MS_PER_DAY);
  const yyyy = String(end.getUTCFullYear()).padStart(4, '0');
  const mm = String(end.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(end.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Package price for a group: the departure override wins when set; otherwise the
 * tier that contains the total pax (adults + children).
 */
export function resolvePlanPackagePrice(input: PlanPriceInput): PlanPriceResult {
  const adults = Number(input.adults) || 0;
  const children = Number(input.children) || 0;
  const total = adults + children;
  if (adults < 1 || total < 1) return { ok: false, reason: 'no_pax' };
  if (input.minPax != null && total < input.minPax) return { ok: false, reason: 'below_min' };
  if (input.maxPax != null && total > input.maxPax) return { ok: false, reason: 'above_max' };

  if (input.departureOverride != null) {
    return { ok: true, price: Number(input.departureOverride), source: 'departure_override' };
  }
  const tier = input.tiers.find((t) => total >= t.min_pax && total <= t.max_pax);
  if (!tier) return { ok: false, reason: 'no_tier' };
  return { ok: true, price: Number(tier.price), source: 'tier' };
}

/** User-facing message for a failed price resolution. */
export function planPriceFailureMessage(
  reason: PlanPriceFailure,
  total: number,
  minPax?: number | null,
  maxPax?: number | null,
): string {
  switch (reason) {
    case 'no_pax':
      return 'Indica al menos un adulto.';
    case 'below_min':
      return `El plan requiere mínimo ${minPax} personas.`;
    case 'above_max':
      return `El plan admite máximo ${maxPax} personas.`;
    default:
      return `No hay tarifa para ${total} ${total === 1 ? 'persona' : 'personas'}.`;
  }
}

/** Hospitality Suite (H2.1) — meal plans a rate plan can include. */
export type MealPlan = 'room_only' | 'breakfast' | 'half_board' | 'full_board' | 'all_inclusive';

export const MEAL_PLAN_LABELS: Record<MealPlan, string> = {
  room_only: 'Solo alojamiento',
  breakfast: 'Con desayuno',
  half_board: 'Media pensión',
  full_board: 'Pensión completa',
  all_inclusive: 'Todo incluido',
};

/**
 * Weekdays in display order (Monday first). `value` is the API weekday:
 * 0 = Sunday .. 6 = Saturday.
 */
export const WEEKDAYS: ReadonlyArray<{ value: number; short: string }> = [
  { value: 1, short: 'Lun' },
  { value: 2, short: 'Mar' },
  { value: 3, short: 'Mié' },
  { value: 4, short: 'Jue' },
  { value: 5, short: 'Vie' },
  { value: 6, short: 'Sáb' },
  { value: 0, short: 'Dom' },
];

/**
 * Nightly price of a room type: base (`day_of_week` null) or a weekday,
 * regular (`season_id` null) or inside a season (H2.2).
 */
export interface RatePrice {
  unit_type_id: number;
  day_of_week: number | null;
  season_id: number | null;
  price: string | number;
}

/** Rate plan as returned by `/store/hospitality/rate-plans`. */
export interface RatePlan {
  id: number;
  name: string;
  code: string | null;
  meal_plan: MealPlan;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  prices: RatePrice[];
  /** H2.4 — cancellation policy and deposit (% of the stay) asked when booking. */
  cancellation_policy_id: number | null;
  cancellation_policy?: { id: number; name: string; is_active: boolean } | null;
  deposit_percent: string | number;
}

export interface RatePlanPayload {
  name: string;
  code?: string;
  meal_plan: MealPlan;
  is_default: boolean;
  is_active: boolean;
  cancellation_policy_id: number | null;
  deposit_percent: number;
  /** Replaces every price of the plan. */
  prices: { unit_type_id: number; day_of_week?: number; season_id?: number; price: number }[];
}

/** Active plan to pick when booking, with the room types it prices. */
export interface SellableRatePlan {
  id: number;
  name: string;
  meal_plan: MealPlan;
  is_default: boolean;
  unit_type_ids: number[];
}

/**
 * Hospitality Suite (H2.2) — demand season as returned by
 * `/store/hospitality/seasons`. Dates come as ISO timestamps at UTC midnight;
 * `to_date` is the last night inside the season.
 */
export interface Season {
  id: number;
  name: string;
  from_date: string;
  to_date: string;
  priority: number;
  color: string;
  is_active: boolean;
}

export interface SeasonPayload {
  name: string;
  /** `YYYY-MM-DD`. */
  from_date: string;
  to_date: string;
  priority: number;
  color: string;
  is_active: boolean;
}

/** `2026-12-15T00:00:00.000Z` → `2026-12-15`. */
export const seasonDate = (value: string): string => value.slice(0, 10);

export const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "15-dic → 15-ene" (first and last night). */
export function seasonRange(season: Pick<Season, 'from_date' | 'to_date'>): string {
  const day = (value: string) => {
    const [, month, dayOfMonth] = seasonDate(value).split('-').map(Number);
    return `${dayOfMonth}-${SHORT_MONTHS[month - 1]}`;
  };
  return `${day(season.from_date)} → ${day(season.to_date)}`;
}

/**
 * The season that colors a night: covering it, highest priority, newest on
 * ties. Same rule as the backend `LodgingRateResolver`.
 */
export function winningSeason(night: string, seasons: readonly Season[]): Season | null {
  let best: Season | null = null;
  for (const season of seasons) {
    if (!season.is_active) continue;
    if (night < seasonDate(season.from_date) || night > seasonDate(season.to_date)) continue;
    if (
      !best ||
      season.priority > best.priority ||
      (season.priority === best.priority && season.id > best.id)
    ) {
      best = season;
    }
  }
  return best;
}

/**
 * Hospitality Suite (H2.3) — stay restrictions of one night as returned by
 * `/store/hospitality/restrictions`. `unit_type_id` null = every room type;
 * min/max stay apply to arrivals that night.
 */
export interface LodgingRestriction {
  id: number;
  /** `YYYY-MM-DD`. */
  date: string;
  unit_type_id: number | null;
  min_stay: number | null;
  max_stay: number | null;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
}

/** Sets (or clears, when all empty) a range of nights for one scope. */
export interface RestrictionPayload {
  from_date: string;
  to_date: string;
  unit_type_id: number | null;
  min_stay: number | null;
  max_stay: number | null;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
}

/** Short calendar labels of a restriction: "Mín. 3", "CTA", "Stop"… */
export function restrictionLabels(r: LodgingRestriction): string[] {
  return [
    r.min_stay ? `Mín. ${r.min_stay}` : '',
    r.max_stay ? `Máx. ${r.max_stay}` : '',
    r.closed_to_arrival ? 'CTA' : '',
    r.closed_to_departure ? 'CTD' : '',
    r.stop_sell ? 'Stop' : '',
  ].filter(Boolean);
}

/**
 * Hospitality Suite (H2.4) — penalty of a cancellation window or a no-show:
 * the first N nights of the stay, or a percent of its total.
 */
export type PenaltyType = 'nights' | 'percent';

export interface PenaltyTerm {
  penalty_type: PenaltyType;
  penalty_value: number;
}

/** Applies when cancelling less than `hours_before` hours before check-in. */
export interface CancellationRule extends PenaltyTerm {
  hours_before: number;
}

/** Policy as returned by `/store/hospitality/cancellation-policies`. */
export interface CancellationPolicy {
  id: number;
  name: string;
  rules: CancellationRule[];
  no_show_penalty: PenaltyTerm | null;
  is_active: boolean;
}

export interface CancellationPolicyPayload {
  name: string;
  rules: CancellationRule[];
  no_show_penalty: PenaltyTerm | null;
  is_active: boolean;
}

/** "1 noche", "2 noches", "50 %". */
export function penaltyLabel(term: PenaltyTerm): string {
  if (term.penalty_type === 'percent') return `${term.penalty_value} %`;
  return `${term.penalty_value} ${term.penalty_value === 1 ? 'noche' : 'noches'}`;
}

/**
 * "Gratis hasta 48 h antes, luego 1 noche · No-show: 100 %". Windows widest
 * first; without windows the cancellation is free.
 */
export function describePolicy(
  policy: Pick<CancellationPolicy, 'rules' | 'no_show_penalty'>,
): string {
  const rules = [...policy.rules].sort((a, b) => b.hours_before - a.hours_before);
  const parts = rules.length
    ? rules.map((rule, index) =>
        index === 0
          ? `Gratis hasta ${rule.hours_before} h antes, luego ${penaltyLabel(rule)}`
          : `desde ${rule.hours_before} h antes, ${penaltyLabel(rule)}`,
      )
    : ['Cancelación gratis'];
  const noShow = policy.no_show_penalty ? penaltyLabel(policy.no_show_penalty) : 'sin penalidad';
  return `${parts.join('; ')} · No-show: ${noShow}`;
}

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

/** Nightly price of a room type: base (`day_of_week` null) or a weekday. */
export interface RatePrice {
  unit_type_id: number;
  day_of_week: number | null;
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
}

export interface RatePlanPayload {
  name: string;
  code?: string;
  meal_plan: MealPlan;
  is_default: boolean;
  is_active: boolean;
  /** Replaces every price of the plan. */
  prices: { unit_type_id: number; day_of_week?: number; price: number }[];
}

/** Active plan to pick when booking, with the room types it prices. */
export interface SellableRatePlan {
  id: number;
  name: string;
  meal_plan: MealPlan;
  is_default: boolean;
  unit_type_ids: number[];
}

/**
 * Frontend source of truth for the membership plans (membership tariffs) domain.
 *
 * Mirrors the backend membership plans DTO contracts exposed under
 * `/store/memberships/plans` (create / update / query).
 */

/**
 * A single access-schedule (opening-hours) window for a membership plan.
 *
 * Mirrors the backend `AccessScheduleWindowDto`. Windows are stored inside the
 * plan's `features.access_schedule` array server-side, but the API surfaces
 * them as a flat top-level `access_schedule` field on both read and write.
 * An empty/absent array means "no schedule restriction" (access at any hour).
 */
export interface AccessScheduleWindow {
  /** 0=Sunday … 6=Saturday. */
  day_of_week: number;
  /** Inclusive start, 24h "HH:mm". */
  start_time: string;
  /** Inclusive end, 24h "HH:mm". */
  end_time: string;
}

export interface GymPlan {
  id: number;
  store_id: number;
  code: string;
  name: string;
  description?: string | null;
  /** Base price (without tax). Decimal(12,2) — arrives as string over JSON. */
  price: number | string;
  currency: string;
  duration_days: number;
  access_limit_per_period?: number | null;
  class_limit_per_period?: number | null;
  /** Flat top-level access schedule surfaced by the API (features.access_schedule). */
  access_schedule?: AccessScheduleWindow[] | null;
  features?: Record<string, unknown> | null;
  product_id?: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CreateGymPlanDto {
  code: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  duration_days?: number;
  access_limit_per_period?: number;
  class_limit_per_period?: number;
  /** Optional per-plan access schedule; sent flat (top-level), in parallel to `features`. */
  access_schedule?: AccessScheduleWindow[];
  features?: Record<string, unknown>;
  product_id?: number;
  is_active?: boolean;
  sort_order?: number;
}

/** All fields optional on update; `code` stays unique per store server-side. */
export type UpdateGymPlanDto = Partial<CreateGymPlanDto>;

export interface GymPlanQuery {
  page?: number;
  limit?: number;
  search?: string;
  is_active?: boolean;
}

export interface RemoveGymPlanResult {
  deleted: boolean;
  deactivated: boolean;
  referencing_memberships: number;
}

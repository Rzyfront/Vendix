/**
 * Frontend source of truth for the membership plans (membership tariffs) domain.
 *
 * Mirrors the backend membership plans DTO contracts exposed under
 * `/store/memberships/plans` (create / update / query).
 */

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

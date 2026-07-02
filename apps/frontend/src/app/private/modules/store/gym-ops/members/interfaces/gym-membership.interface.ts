/**
 * Gym Suite — Ola 1.
 * Frontend source of truth for gym memberships and member profiles.
 *
 * Mirrors the Prisma models `gym_memberships` / `gym_member_profiles` and the
 * DTO contracts in `apps/backend/src/domains/store/gym-memberships`.
 */

export type GymMembershipStatus =
  | 'active'
  | 'expired'
  | 'suspended'
  | 'frozen'
  | 'pending_payment'
  | 'cancelled';

/** Plan snapshot attached to a membership by the backend `attachRelations`. */
export interface GymMembershipPlanRef {
  id: number;
  code: string;
  name: string;
  price: number | string;
  currency: string;
  duration_days: number;
}

/** Customer snapshot attached to a membership by the backend `attachRelations`. */
export interface GymMembershipCustomerRef {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface GymMembership {
  id: number;
  store_id: number;
  customer_id: number;
  gym_plan_id: number;
  status: GymMembershipStatus;
  period_start?: string | null;
  period_end?: string | null;
  auto_renew: boolean;
  source_order_id?: number | null;
  notes?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  plan?: GymMembershipPlanRef | null;
  customer?: GymMembershipCustomerRef | null;
}

export interface CreateGymMembershipDto {
  customer_id: number;
  gym_plan_id: number;
  period_start?: string;
  status?: GymMembershipStatus;
  auto_renew?: boolean;
  notes?: string;
}

/** Only editable metadata; status changes go through the transition endpoints. */
export interface UpdateGymMembershipDto {
  auto_renew?: boolean;
  notes?: string;
}

export interface GymMembershipQuery {
  page?: number;
  limit?: number;
  status?: GymMembershipStatus;
  customer_id?: number;
  gym_plan_id?: number;
}

export interface RenewMembershipDto {
  store_payment_method_id: number;
  amount?: number;
  currency?: string;
  customer_email?: string;
  customer_name?: string;
  customer_phone?: string;
}

export interface RenewMembershipResult {
  membership: GymMembership;
  payment: unknown;
  renewed: boolean;
}

/** gym_member_profiles row (one per store+customer). */
export interface GymMemberProfile {
  id?: number;
  store_id?: number;
  customer_id?: number;
  date_of_birth?: string | null;
  gender?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  medical_notes?: string | null;
  goals?: string | null;
  height_cm?: number | null;
  weight_kg?: number | string | null;
}

export interface UpsertMemberProfileDto {
  date_of_birth?: string;
  gender?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  medical_notes?: string;
  goals?: string;
  height_cm?: number;
  weight_kg?: number;
}

/** Status → Spanish label. */
export const GYM_MEMBERSHIP_STATUS_LABELS: Record<GymMembershipStatus, string> = {
  active: 'Activa',
  expired: 'Vencida',
  suspended: 'Suspendida',
  frozen: 'Congelada',
  pending_payment: 'Pago pendiente',
  cancelled: 'Cancelada',
};

/** Status → 7-char hex color (colorMap requires hex, not Tailwind classes). */
export const GYM_MEMBERSHIP_STATUS_COLORS: Record<GymMembershipStatus, string> = {
  active: '#16a34a',
  expired: '#78716c',
  suspended: '#dc2626',
  frozen: '#2563eb',
  pending_payment: '#d97706',
  cancelled: '#6b7280',
};

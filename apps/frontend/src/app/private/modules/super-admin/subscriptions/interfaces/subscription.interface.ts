export type PlanType = 'base' | 'pro' | 'enterprise' | 'custom';
export type BillingCycle = 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
export type SubscriptionState = 'trial' | 'active' | 'grace_soft' | 'grace_hard' | 'suspended' | 'cancelled' | 'blocked';
export type PromoState = 'active' | 'paused' | 'expired' | 'draft';
export type PayoutState = 'pending' | 'approved' | 'paid' | 'rejected';
export type EventType = 'created' | 'activated' | 'renewed' | 'grace_soft' | 'grace_hard' | 'suspended' | 'cancelled' | 'reactivated' | 'blocked' | 'plan_changed' | 'trial_started' | 'trial_ended';

export interface Plan {
  id: number;
  code: string;
  name: string;
  plan_type: PlanType;
  billing_cycle: BillingCycle;
  base_price: number;
  description?: string;
  ai_feature_flags: Record<string, boolean>;
  feature_matrix: Record<string, any>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  _count?: { subscriptions: number };
}

export interface CreatePlanDto {
  code: string;
  name: string;
  plan_type: PlanType;
  billing_cycle: BillingCycle;
  base_price: number;
  description?: string;
  ai_feature_flags?: Record<string, boolean>;
  feature_matrix?: Record<string, any>;
}

export interface UpdatePlanDto extends Partial<CreatePlanDto> {}

export interface PlanStats {
  totalPlans: number;
  activePlans: number;
  activeSubscriptions: number;
  monthlyRevenue: number;
}

export interface Partner {
  id: number;
  organization_id: number;
  organization: { id: number; name: string };
  margin_pct: number;
  overrides_count: number;
  total_commissions: number;
  pending_commissions: number;
  created_at: string;
}

export interface PartnerStats {
  totalPartners: number;
  pendingCommissions: number;
  monthlyPayouts: number;
  avgMargin: number;
}

export interface PartnerDetail {
  id: number;
  organization_id: number;
  organization: { id: number; name: string };
  margin_pct: number;
  overrides: Array<{ id: number; plan_id: number; plan_name: string; price_override: number }>;
  commissions: Array<{ id: number; amount: number; period: string; state: string }>;
}

export interface Promotional {
  id: number;
  name: string;
  criteria: Record<string, any>;
  priority: number;
  state: PromoState;
  starts_at: string;
  ends_at: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  _count?: { stores: number };
  created_at: string;
}

export interface PromoStats {
  activePromos: number;
  storesWithPromo: number;
  expiringThisWeek: number;
}

export interface ActiveSubscription {
  id: number;
  store_id: number;
  store: { id: number; name: string };
  plan_id: number;
  plan: { id: number; name: string; code: string };
  state: SubscriptionState;
  effective_price: number;
  trial_ends_at?: string;
  next_billing_at: string;
  started_at: string;
  created_at: string;
}

export interface ActiveSubscriptionStats {
  totalActive: number;
  inTrial: number;
  inGrace: number;
  suspended: number;
}

export interface DunningSubscription {
  id: number;
  store_id: number;
  store: { id: number; name: string };
  plan: { id: number; name: string };
  state: SubscriptionState;
  overdue_days: number;
  next_billing_at: string;
  last_reminder_at?: string;
  reminder_count: number;
}

export interface DunningStats {
  graceSoft: number;
  graceHard: number;
  suspended: number;
  blocked: number;
}

export interface Payout {
  id: number;
  partner_id: number;
  partner: { id: number; organization: { name: string } };
  period: string;
  total_amount: number;
  state: PayoutState;
  approved_at?: string;
  paid_at?: string;
  created_at: string;
}

export interface PayoutStats {
  totalPayouts: number;
  pendingPayouts: number;
  paidThisMonth: number;
  totalAmount: number;
}

export interface SubscriptionEvent {
  id: number;
  subscription_id: number;
  type: EventType;
  from_state: SubscriptionState | null;
  to_state: SubscriptionState;
  metadata: Record<string, any>;
  created_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface QueryDto {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  state?: string;
}

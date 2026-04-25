export interface StoreSubscription {
  id: string;
  store_id: number;
  store_name: string;
  store_slug: string;
  plan_name: string;
  plan_id: string;
  state: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired' | 'blocked' | 'grace_soft' | 'grace_hard' | 'none';
  effective_price: number;
  currency: string;
  next_billing_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
  updated_at: string;
  split_breakdown?: {
    vendix_share: number;
    partner_share: number;
    margin_pct: string;
    partner_org_id: number | null;
  };
}

export interface InvoiceEntry {
  id: number;
  invoice_number: string;
  state: 'draft' | 'issued' | 'paid' | 'void' | 'partially_paid' | 'overdue' | 'refunded';
  total: number;
  currency: string;
  issued_at: string | null;
  due_at: string;
  period_start: string;
  period_end: string;
  created_at: string;
}

export interface PartnerPlanOverride {
  id: string;
  organization_id: number;
  base_plan_id: string;
  base_plan_name: string;
  custom_name: string | null;
  margin_pct: number;
  effective_price: number;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommissionEntry {
  id: string;
  invoice_number: string;
  store_id: number;
  store_name: string;
  amount: number;
  currency: string;
  state: 'accrued' | 'pending_payout' | 'paid' | 'failed';
  period_start: string;
  period_end: string;
  paid_at: string | null;
  created_at: string;
}

export interface CommissionSummary {
  accrued: number;
  pending_payout: number;
  paid: number;
  total_history: number;
  currency: string;
}

export interface PayoutEntry {
  id: string;
  amount: number;
  currency: string;
  state: 'pending' | 'completed' | 'failed';
  paid_at: string | null;
  method: string;
  commissions_count: number;
  created_at: string;
}

export interface SubscriptionOverviewStats {
  active_stores: number;
  active_subscriptions: number;
  monthly_revenue: number;
  partner_commissions: number;
  currency: string;
}

export interface CreatePlanOverrideDto {
  base_plan_id: string;
  custom_name?: string;
  margin_pct: number;
}

export interface UpdatePlanOverrideDto {
  custom_name?: string;
  margin_pct?: number;
  is_active?: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

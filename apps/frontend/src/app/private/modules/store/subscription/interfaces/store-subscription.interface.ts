export interface SubscriptionPlan {
  id: string;
  name: string;
  code: string;
  description: string;
  base_price: number;
  currency: string;
  billing_cycle: 'monthly' | 'yearly';
  features: PlanFeature[];
  is_current: boolean;
  is_popular: boolean;
  sort_order: number;
}

export interface PlanFeature {
  key: string;
  label: string;
  enabled: boolean;
  limit: number | null;
  unit: string | null;
}

export interface CurrentSubscription {
  id: string;
  plan_id: string;
  plan_name: string;
  plan_code: string;
  status: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired' | 'blocked' | 'grace_soft' | 'grace_hard' | 'none';
  effective_price: number;
  currency: string;
  billing_cycle: 'monthly' | 'yearly';
  current_period_start: string;
  current_period_end: string;
  next_billing_at: string | null;
  trial_ends_at: string | null;
  cancelled_at: string | null;
  features: Record<string, FeatureUsage>;
}

export interface FeatureUsage {
  enabled: boolean;
  label: string;
  used: number;
  limit: number | null;
  unit: string | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  tax: number;
  total: number;
  state: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  period_start: string;
  period_end: string;
  due_date: string;
  paid_at: string | null;
  created_at: string;
}

export interface CheckoutPreview {
  old_plan: SubscriptionPlan;
  new_plan: SubscriptionPlan;
  proration_amount: number;
  credit_amount: number;
  charge_amount: number;
  currency: string;
  effective_date: string;
  next_billing_amount: number;
  next_billing_date: string;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_transfer';
  last4: string | null;
  brand: string | null;
  is_default: boolean;
  created_at: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

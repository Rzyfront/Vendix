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

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: string;
  total: string;
  meta: {
    plan_id: number;
    plan_code: string;
    margin_pct?: string;
    billing_cycle: string;
    prorated?: boolean;
  };
}

export interface InvoiceSplitBreakdown {
  vendix_share: string;
  partner_share: string;
  margin_pct_used: string;
  partner_org_id: number | null;
}

export interface InvoicePreview {
  total: string;
  period_start: string;
  period_end: string;
  line_items: InvoiceLineItem[];
  split_breakdown: InvoiceSplitBreakdown;
}

export type ProrationKind = 'upgrade' | 'downgrade' | 'same-tier';

export interface ProrationPreview {
  kind: ProrationKind;
  days_remaining: number;
  cycle_days: number;
  old_effective_price: string;
  new_effective_price: string;
  proration_amount: string;
  applies_immediately: boolean;
  invoice_to_issue: InvoicePreview | null;
  credit_to_apply_next_cycle: string;
}

export interface FreePlanInfo {
  plan: {
    id: number;
    code: string;
    name: string;
    effective_price: string;
    billing_cycle: string;
    trial_days: number;
  };
}

export interface CheckoutPreviewResponse {
  proration: ProrationPreview | null;
  invoice: InvoicePreview | null;
  free_plan: FreePlanInfo | null;
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

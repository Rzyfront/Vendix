export type PlanType = 'base' | 'partner_custom' | 'promotional';
export type PlanState = 'draft' | 'active' | 'archived';
export type PlanBillingCycle =
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'biannual'
  | 'annual'
  | 'lifetime';

export interface SubscriptionPlan {
  // Identity
  id: string;
  code: string;
  name: string;
  description: string;

  // Type / state / billing
  plan_type: PlanType;
  state: PlanState;
  billing_cycle: PlanBillingCycle;

  // Money (Decimal coerced to number; null allowed for optional)
  base_price: number;
  currency: string;
  setup_fee: number | null;

  // Trial + dunning
  trial_days: number;
  grace_period_soft_days: number;
  grace_period_hard_days: number;
  suspension_day: number;
  cancellation_day: number;

  // Feature matrices
  feature_matrix: Record<string, unknown>;
  ai_feature_flags: AIFeatureFlags;

  // Partner
  resellable: boolean;
  max_partner_margin_pct: number | null;

  // Promotional
  is_promotional: boolean;
  promo_rules: Record<string, unknown> | null;
  promo_priority: number;

  // Display
  is_popular: boolean;
  sort_order: number;
  is_default: boolean;

  // Hierarchy / metadata (read-only)
  parent_plan_id: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;

  // Derived helpers (kept for legacy consumers like plan-card / plans table)
  slug: string;            // alias of code
  is_active: boolean;      // state === 'active'
  is_public: boolean;      // alias of resellable
  pricing: PlanPricing[];  // derived from base_price + billing_cycle + currency
  grace_threshold_days: number; // alias of grace_period_soft_days
}

export interface AIFeatureFlags {
  chat_enabled: boolean;
  embeddings_enabled: boolean;
  agent_enabled: boolean;
  rag_enabled: boolean;
  streaming_enabled: boolean;
  max_tokens_per_month: number;
  max_conversations: number;
  allowed_models: string[];
  custom_tools_enabled: boolean;
}

export interface PlanPricing {
  id: string;
  billing_cycle: 'monthly' | 'quarterly' | 'biannual' | 'annual';
  price: number;
  currency_code: string;
  is_default: boolean;
}

export interface PartnerOrganization {
  id: string;
  name: string;
  slug: string;
  email: string;
  is_partner: boolean;
  partner_margin_percent: number;
  partner_margin_cap: number | null;
  partner_override_pricing: Record<string, number>;
  total_referred_stores: number;
  total_earnings: number;
  pending_payout: number;
  state: string;
  created_at: string;
}

export interface PromotionalPlan {
  id: string;
  name: string;
  code: string;
  discount_percent: number;
  discount_amount: number | null;
  max_uses: number | null;
  used_count: number;
  valid_from: string;
  valid_until: string | null;
  applicable_plan_ids: string[];
  is_active: boolean;
  created_at: string;
}

export interface StoreSubscription {
  id: string;
  store_id: string;
  store_name: string;
  organization_name: string;
  plan_name: string;
  billing_cycle: string;
  price: number;
  currency_code: string;
  status: 'active' | 'grace' | 'suspended' | 'cancelled' | 'trial';
  current_period_start: string;
  current_period_end: string;
  grace_period_end: string | null;
  auto_renew: boolean;
  partner_id: string | null;
  partner_margin_amount: number;
  created_at: string;
}

export interface DunningSubscription {
  id: string;
  store_id: string;
  store_name: string;
  organization_name: string;
  plan_name: string;
  price: number;
  currency_code: string;
  status: 'grace' | 'suspended';
  current_period_end: string;
  grace_period_end: string | null;
  days_overdue: number;
  payment_attempts: number;
  last_payment_attempt: string | null;
}

export interface PartnerPayout {
  id: string;
  partner_id: string;
  partner_name: string;
  period_start: string;
  period_end: string;
  total_amount: number;
  currency_code: string;
  store_count: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface SubscriptionEvent {
  id: string;
  subscription_id: string;
  event_type: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
}

export interface SubscriptionStats {
  totalPlans: number;
  activePlans: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  graceSubscriptions: number;
  suspendedSubscriptions: number;
  totalPartners: number;
  totalMonthlyRevenue: number;
  currencyCode: string;
}

export interface PlanFormData {
  // Identity
  code: string;
  name: string;
  description: string;
  // Type / state / billing
  plan_type: PlanType;
  state: PlanState;
  billing_cycle: PlanBillingCycle;
  // Money
  base_price: number;
  currency: string;
  setup_fee: number | null;
  // Trial + dunning
  trial_days: number;
  grace_period_soft_days: number;
  grace_period_hard_days: number;
  suspension_day: number;
  cancellation_day: number;
  // Partner
  resellable: boolean;
  max_partner_margin_pct: number | null;
  // Promotional
  is_promotional: boolean;
  promo_priority: number;
  // Display
  is_popular: boolean;
  sort_order: number;
  is_default: boolean;
  // Feature matrices
  ai_feature_flags: AIFeatureFlags;
  feature_matrix?: Record<string, unknown>;
  // Pricing array (derived from base_price + billing_cycle + currency, kept for child cmp)
  pricing: PlanPricing[];
}

export interface CreatePlanDto {
  // Identity
  code: string;
  name: string;
  description?: string;
  // Type / state / billing
  plan_type: PlanType;
  state: PlanState;
  billing_cycle: PlanBillingCycle;
  // Money
  base_price: number;
  currency: string;
  setup_fee?: number | null;
  // Trial + dunning
  trial_days?: number;
  grace_period_soft_days?: number;
  grace_period_hard_days?: number;
  suspension_day?: number;
  cancellation_day?: number;
  // Partner
  resellable?: boolean;
  max_partner_margin_pct?: number | null;
  // Promotional
  is_promotional?: boolean;
  promo_priority?: number;
  // Display
  is_popular?: boolean;
  sort_order?: number;
  is_default?: boolean;
  // Feature matrices
  ai_feature_flags?: AIFeatureFlags;
  feature_matrix?: Record<string, unknown>;
}

export interface UpdatePlanDto extends Partial<CreatePlanDto> {}

export interface UpdatePartnerDto {
  is_partner?: boolean;
  partner_margin_percent?: number;
  partner_margin_cap?: number | null;
  partner_override_pricing?: Record<string, number>;
}

export interface CreatePromotionalDto {
  name: string;
  code: string;
  discount_percent: number;
  discount_amount: number | null;
  max_uses: number | null;
  valid_from: string;
  valid_until: string | null;
  applicable_plan_ids: string[];
}

export interface UpdatePromotionalDto extends Partial<CreatePromotionalDto> {}

export interface PayoutApprovalDto {
  status: 'approved' | 'rejected';
  notes?: string;
}

export type SubscriptionStatus = 'active' | 'grace' | 'suspended' | 'cancelled' | 'trial';
export type BillingCycle = PlanBillingCycle;

// ─── Dunning manual transition preview (S4.1) ───

export type DunningPreviewTargetState =
  | 'draft'
  | 'pending_payment'
  | 'trial'
  | 'active'
  | 'grace_soft'
  | 'grace_hard'
  | 'suspended'
  | 'blocked'
  | 'cancelled'
  | 'expired';

export interface DunningPreviewEmail {
  key: string;
  to: string;
  subject: string;
}

export interface DunningPreviewInvoice {
  id: number;
  invoice_number: string;
  state: string;
  total: number;
}

export interface DunningPreviewCommission {
  id: number;
  partner_org_id: number;
  amount: number;
  state: string;
}

export interface DunningPreviewSideEffects {
  emails_to_send: DunningPreviewEmail[];
  features_lost: string[];
  features_gained: string[];
  invoices_affected: DunningPreviewInvoice[];
  commissions_affected: DunningPreviewCommission[];
}

export interface DunningPreviewResponse {
  legal: boolean;
  current_state: DunningPreviewTargetState;
  target_state: DunningPreviewTargetState;
  side_effects: DunningPreviewSideEffects;
  warnings: string[];
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
  is_public: boolean;
  ai_feature_flags: AIFeatureFlags;
  pricing: PlanPricing[];
  grace_threshold_days: number;
  created_at: string;
  updated_at: string;
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
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
  is_public: boolean;
  ai_feature_flags: AIFeatureFlags;
  pricing: PlanPricing[];
  grace_threshold_days: number;
}

export interface CreatePlanDto {
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
  is_public: boolean;
  ai_feature_flags: AIFeatureFlags;
  pricing: Omit<PlanPricing, 'id'>[];
  grace_threshold_days: number;
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
export type BillingCycle = 'monthly' | 'quarterly' | 'biannual' | 'annual';

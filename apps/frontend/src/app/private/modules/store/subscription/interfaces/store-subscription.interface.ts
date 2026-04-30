export interface SubscriptionPlan {
  id: string;
  name: string;
  code: string;
  description: string;
  base_price: number;
  currency: string;
  billing_cycle: 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'lifetime';
  features: PlanFeature[];
  is_current: boolean;
  is_popular: boolean;
  /**
   * Explicit free-plan flag (server-authoritative). Mirrors
   * `subscription_plans.is_free` in BD. Frontends should branch on this rather
   * than `base_price === 0` to support partner-margin overrides on free base
   * plans.
   */
  is_free?: boolean;
  sort_order: number;
}

export interface PlanFeature {
  key: string;
  label: string;
  enabled: boolean;
  limit: number | null;
  unit: string | null;
}

/**
 * Pending plan change kinds as returned by the backend enum
 * `subscription_change_kind_enum`.
 */
export type SubscriptionChangeKind =
  | 'initial'
  | 'renewal'
  | 'upgrade'
  | 'downgrade'
  | 'resubscribe'
  | 'trial_conversion';

/**
 * Subscription states as returned by the backend enum
 * `store_subscription_state_enum`.
 */
export type StoreSubscriptionState =
  | 'draft'
  | 'trial'
  | 'active'
  | 'grace_soft'
  | 'grace_hard'
  | 'suspended'
  | 'blocked'
  | 'cancelled'
  | 'expired'
  | 'pending_payment'
  | 'no_plan';

export interface CurrentSubscription {
  id: string;
  plan_id: string;
  plan_name: string;
  plan_code: string;
  status: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired' | 'blocked' | 'grace_soft' | 'grace_hard' | 'none';
  /** Backend field: `store_subscriptions.state` (canonical enum). */
  state?: StoreSubscriptionState;
  effective_price: number;
  currency: string;
  billing_cycle: 'monthly' | 'yearly';
  current_period_start: string;
  current_period_end: string;
  next_billing_at: string | null;
  trial_ends_at: string | null;
  cancelled_at: string | null;
  scheduled_cancel_at?: string | null;
  features: Record<string, FeatureUsage>;
  // ── Plan Seleccionado vs Plan Pagado ─────────────────────────────────────
  /**
   * The plan whose features/price the store is currently billed on.
   * Set once a payment clears. Null when on a free or trial plan with no
   * prior payment.
   */
  paid_plan_id?: number | null;
  /**
   * The plan the store has selected but not yet activated (e.g. a deferred
   * downgrade scheduled for the next billing cycle). Null when there is no
   * pending plan change.
   */
  pending_plan_id?: number | null;
  /**
   * The subscription_invoices.id tied to the pending plan change. Null when
   * no plan-change invoice has been issued yet.
   */
  pending_change_invoice_id?: number | null;
  /**
   * The kind of pending plan change (upgrade, downgrade, etc.).
   * Maps to `subscription_change_kind_enum` in the DB.
   */
  pending_change_kind?: SubscriptionChangeKind | null;
  /**
   * ISO timestamp of when the pending plan change was initiated.
   */
  pending_change_started_at?: string | null;
  /**
   * The state the subscription should revert to if the pending change is
   * cancelled. Maps to `store_subscription_state_enum`.
   */
  pending_revert_state?: StoreSubscriptionState | null;
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

export type ProrationKind =
  | 'upgrade'
  | 'downgrade'
  | 'same-tier'
  | 'trial_plan_swap'
  | 're_subscribe';

/**
 * S3.4 — Trial plan-swap metadata. Surfaced when subscription.state === 'trial'
 * AND trial_ends_at is in the future. The swap is free: no invoice, no state
 * change. The first paid charge happens at trial_ends_at.
 */
export interface TrialPlanSwapInfo {
  old_plan: { id: number; code: string; name: string; base_price: string };
  new_plan: { id: number; code: string; name: string; base_price: string };
  trial_ends_at: string;
  message: string;
}

export interface ProrationPreview {
  kind: ProrationKind;
  mode?: ProrationKind;
  days_remaining: number;
  cycle_days: number;
  old_effective_price: string;
  new_effective_price: string;
  proration_amount: string;
  applies_immediately: boolean;
  invoice_to_issue: InvoicePreview | null;
  credit_to_apply_next_cycle: string;
  /** S3.4 — Set only when kind === 'trial_plan_swap'. */
  trial_swap?: TrialPlanSwapInfo;
  /** S3.4 — Moment the new plan starts being billed. */
  effective_at?: string;
  /**
   * S3.5 — Set when the source sub has `scheduled_cancel_at` and the
   * checkout will void the scheduled cancellation as a side-effect of the
   * commit. Frontend uses it to render a notice.
   */
  voids_scheduled_cancel?: {
    active: boolean;
    scheduled_at: string;
  };
  /**
   * Whether the destination plan is configured as free
   * (`subscription_plans.is_free=true` server-side). Used by the checkout
   * component as defense-in-depth: when the backend returns `widget=null` but
   * target is paid AND `proration_amount > 0`, the UI surfaces an error
   * rather than navigating to a misleading success.
   */
  target_plan_is_free?: boolean;
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
  /** S2.1 — Coupon overlay echoed by the backend when coupon_code was sent. */
  coupon?: CouponPreviewInfo | null;
}

/**
 * S2.1 — Result of POST /store/subscriptions/checkout/validate-coupon.
 *
 * `valid:false` discriminator codes:
 *  - `not_found` — no plan with that redemption_code, or empty input.
 *  - `expired` — promo_rules.starts_at in the future or ends_at in the past.
 *  - `already_used` — store has already redeemed this promo, or
 *    max_uses / max_uses_per_org reached.
 *  - `not_eligible` — any other rule violation (region, target list, plan
 *    type mismatch, store count, etc.).
 *  - `invalid_state` — plan exists but is archived / not active / not
 *    promotional.
 */
export interface CouponValidationResponse {
  valid: boolean;
  reason?: 'not_found' | 'expired' | 'already_used' | 'not_eligible' | 'invalid_state';
  reasons_blocked?: string[];
  plan?: {
    id: number;
    code: string;
    name: string;
    description: string | null;
    plan_type: string;
    base_price: string;
    currency: string;
    promo_priority: number;
  };
  overlay_features?: Record<string, unknown>;
  duration_days?: number | null;
  starts_at?: string | null;
  expires_at?: string | null;
}

export interface CouponPreviewInfo {
  valid: boolean;
  reason?: string;
  reasons_blocked?: string[];
  code: string;
  plan?: {
    id: number;
    code: string;
    name: string;
    plan_type: string;
  };
  overlay_features?: Record<string, unknown>;
  duration_days?: number | null;
  starts_at?: string | null;
  expires_at?: string | null;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_transfer';
  last4: string | null;
  brand: string | null;
  is_default: boolean;
  created_at: string;
  // G11 — surfaced so the banner / payment-method UI can warn the user
  // before a charge is attempted with an expired or invalidated card.
  expiry_month?: string | null;
  expiry_year?: string | null;
  state?: 'active' | 'invalid' | 'replaced' | 'removed' | string;
  consecutive_failures?: number;
  /**
   * Fase 4 (Wompi recurrent migration) — populated by the backend once
   * the card has been registered as a Wompi `payment_source` (COF) via
   * the new tokenize endpoint. When present, the UI surfaces a
   * "Verificada para cobros recurrentes" badge so the user knows the
   * card will be charged automatically on renewal.
   *
   * Optional + defensive: legacy methods registered before Fase 5
   * shipped will not have this field.
   */
  providerPaymentSourceId?: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * S3.2 — One row of the per-PM charge history (subscription_payments
 * filtered by metadata.saved_payment_method_id). Surfaced inside the
 * "Configurar Tarjeta" modal as recent activity.
 */
export interface PaymentMethodCharge {
  id: string;
  invoice_number: string | null;
  amount: string;
  currency: string;
  state: 'pending' | 'succeeded' | 'failed' | 'refunded' | string;
  paid_at: string | null;
  created_at: string;
  failure_reason: string | null;
}

/**
 * S3.3 — Subscription event row exposed to the customer timeline.
 * NOTE: `triggered_by_user_id` is intentionally omitted by the backend.
 */
export type SubscriptionEventType =
  | 'created'
  | 'activated'
  | 'renewed'
  | 'trial_started'
  | 'trial_ended'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'state_transition'
  | 'plan_changed'
  | 'cancelled'
  | 'reactivated'
  | 'promotional_applied'
  | 'partner_override_applied'
  | 'partner_commission_accrued'
  | 'partner_commission_paid'
  | 'scheduled_cancel';

export interface SubscriptionTimelineEvent {
  id: number;
  type: SubscriptionEventType;
  from_state: string | null;
  to_state: string | null;
  payload: Record<string, unknown> | null;
  triggered_by: 'user' | 'system' | 'cron';
  created_at: string;
}

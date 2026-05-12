import { Prisma } from '@prisma/client';

/**
 * Billing-level shared types for subscription invoices, payments, and
 * proration calculations. Money is ALWAYS Prisma.Decimal — no JS numbers.
 */

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: string; // Decimal serialized
  total: string; // Decimal serialized
  meta: {
    plan_id: number;
    plan_code: string;
    margin_pct?: string; // Decimal serialized (null when no partner)
    billing_cycle: string;
    prorated?: boolean;
    fresh_purchase?: boolean;
    plan_change?: boolean;
    kind?: ProrationKind;
    unused_credit_applied?: string;
  };
}

export interface InvoiceSplitBreakdown {
  /** Vendix share = base_price * quantity (Decimal serialized). */
  vendix_share: string;
  /** Partner share = margin_amount * quantity (Decimal serialized). */
  partner_share: string;
  /** Margin pct used, echoed for audit (Decimal serialized, "0" if no partner). */
  margin_pct_used: string;
  /** Partner organization id (null when no partner). */
  partner_org_id: number | null;
}

export interface InvoicePreview {
  total: string; // Decimal serialized
  period_start: string; // ISO
  period_end: string; // ISO
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
 * Legacy trial plan-swap metadata. Kept for backwards compatibility with old
 * clients, but current trial → free checkout starts a fresh free cycle
 * immediately and does not carry trial_ends_at forward.
 */
export interface TrialPlanSwapInfo {
  old_plan: { id: number; code: string; name: string; base_price: string };
  new_plan: { id: number; code: string; name: string; base_price: string };
  trial_ends_at: string; // ISO
  /** Spanish copy ready for display. */
  message: string;
}

export interface ProrationPreview {
  kind: ProrationKind;
  /**
   * S3.4 — Free-form mode mirroring `kind` for finer-grained UI branches.
   */
  mode?: ProrationKind;
  days_remaining: number;
  cycle_days: number;
  old_effective_price: string; // Decimal serialized
  new_effective_price: string; // Decimal serialized
  /** Positive => charge now, negative => credit for next invoice. */
  proration_amount: string; // Decimal serialized
  applies_immediately: boolean;
  invoice_to_issue: InvoicePreview | null;
  credit_to_apply_next_cycle: string; // Decimal serialized
  /**
   * Legacy payload for older trial-swap previews. New trial → free previews do
   * not set it because the change is immediate.
   */
  trial_swap?: TrialPlanSwapInfo;
  /**
   * Moment when the destination plan takes effect. For immediate paths it
   * mirrors `now`.
   */
  effective_at?: string; // ISO
  /**
   * S3.5 — Set when the source sub has `scheduled_cancel_at` and the
   * checkout will void the scheduled cancellation as a side-effect of the
   * commit (clears `scheduled_cancel_at` + restores `auto_renew=true`). The
   * frontend renders a notice so the user understands the implicit revert.
   */
  voids_scheduled_cancel?: {
    active: boolean;
    scheduled_at: string; // ISO
  };
  /**
   * Whether the destination plan is configured as free (`subscription_plans.is_free=true`).
   * Used by frontend defense-in-depth: if the target is paid AND
   * `proration_amount > 0` AND backend returned `widget=null`, the UI must
   * surface an error rather than navigating to "success". Replaces the legacy
   * `base_price <= 0` heuristic that fails silently when sub.plan is null.
   */
  target_plan_is_free?: boolean;
}

export interface FreePlanInfo {
  plan: {
    id: number;
    code: string;
    name: string;
    effective_price: string; // Decimal serialized — always "0" or "0.00"
    billing_cycle: string;
  };
}

/** Response shape for /checkout/preview. Distinguishes paid vs free plan flows. */
export interface CheckoutPreviewResult {
  proration: ProrationPreview | null;
  invoice: InvoicePreview | null;
  free_plan: FreePlanInfo | null;
  /**
   * S2.1 — Coupon overlay preview. When the request carries a `coupon_code`
   * the backend re-validates and projects the overlay that will land if the
   * commit succeeds. `null` when no coupon was sent or it was invalid.
   */
  coupon?: CouponPreviewInfo | null;
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

export interface PartnerLedger {
  accrued: string;
  pending_payout: string;
  paid: string;
  total_history: string;
}

/** Internal — not exported via DTOs. */
export interface ComputedPricing {
  base_price: Prisma.Decimal;
  margin_pct: Prisma.Decimal; // 0 when no partner
  margin_amount: Prisma.Decimal; // 0 when no partner
  fixed_surcharge: Prisma.Decimal; // 0 when no partner
  effective_price: Prisma.Decimal;
  partner_org_id: number | null;
}

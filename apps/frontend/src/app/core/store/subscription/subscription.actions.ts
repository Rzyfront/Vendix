import { createAction, props } from '@ngrx/store';
import { NormalizedApiPayload } from '../../utils/api-error-handler';

/**
 * Fired when the active store context changes (login, store switch, logout).
 * The reducer wipes any subscription data tied to the previous store so the
 * banner cannot flash stale info, and the effect chains a `loadCurrent()` to
 * refetch the new store's subscription state.
 *
 * `storeId = null` means "no store context" (e.g. ORG_ADMIN, SUPER_ADMIN, or
 * logout) and only triggers the wipe — no fetch is dispatched.
 */
export const subscriptionContextChanged = createAction(
  '[Subscription] Context Changed',
  props<{ storeId: number | null }>(),
);

export const loadCurrent = createAction('[Subscription] Load Current');

export const loadCurrentSuccess = createAction(
  '[Subscription] Load Current Success',
  props<{ subscription: any }>(),
);

export const loadCurrentFailure = createAction(
  '[Subscription] Load Current Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const loadAccess = createAction('[Subscription] Load Access');

export const loadAccessSuccess = createAction(
  '[Subscription] Load Access Success',
  props<{ access: any }>(),
);

export const loadAccessFailure = createAction(
  '[Subscription] Load Access Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const subscribe = createAction(
  '[Subscription] Subscribe',
  props<{ planId: string; partnerOverrideId?: string }>(),
);

export const subscribeSuccess = createAction(
  '[Subscription] Subscribe Success',
  props<{ subscription: any }>(),
);

export const subscribeFailure = createAction(
  '[Subscription] Subscribe Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const cancel = createAction(
  '[Subscription] Cancel',
  props<{ reason?: string }>(),
);

export const cancelSuccess = createAction(
  '[Subscription] Cancel Success',
  props<{ subscription: any }>(),
);

export const cancelFailure = createAction(
  '[Subscription] Cancel Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const scheduleCancel = createAction(
  '[Subscription] Schedule Cancel',
  props<{ reason?: string }>(),
);

export const scheduleCancelSuccess = createAction(
  '[Subscription] Schedule Cancel Success',
  props<{ subscription: any }>(),
);

export const scheduleCancelFailure = createAction(
  '[Subscription] Schedule Cancel Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const changePlan = createAction(
  '[Subscription] Change Plan',
  props<{ planId: string }>(),
);

export const changePlanSuccess = createAction(
  '[Subscription] Change Plan Success',
  props<{ subscription: any }>(),
);

export const changePlanFailure = createAction(
  '[Subscription] Change Plan Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const checkoutPreview = createAction(
  '[Subscription] Checkout Preview',
  props<{ planId: string }>(),
);

export const checkoutPreviewSuccess = createAction(
  '[Subscription] Checkout Preview Success',
  props<{ preview: any }>(),
);

export const checkoutPreviewFailure = createAction(
  '[Subscription] Checkout Preview Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const checkoutCommit = createAction(
  '[Subscription] Checkout Commit',
  props<{ planId: string; paymentMethodId?: string }>(),
);

export const checkoutCommitSuccess = createAction(
  '[Subscription] Checkout Commit Success',
  props<{ subscription: any }>(),
);

export const checkoutCommitFailure = createAction(
  '[Subscription] Checkout Commit Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const loadInvoices = createAction('[Subscription] Load Invoices');

export const loadInvoicesSuccess = createAction(
  '[Subscription] Load Invoices Success',
  props<{ invoices: any[] }>(),
);

export const loadInvoicesFailure = createAction(
  '[Subscription] Load Invoices Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const loadSubscription = createAction(
  '[Subscription] Load Subscription',
);

export const loadSubscriptionSuccess = createAction(
  '[Subscription] Load Subscription Success',
  props<{ subscription: any }>(),
);

export const loadSubscriptionFailure = createAction(
  '[Subscription] Load Subscription Failure',
  props<{ error: any }>(),
);

export const subscriptionUpdated = createAction(
  '[Subscription] Subscription Updated',
  props<{ subscription: any }>(),
);

// G6 — Dunning board

export interface DunningState {
  state: string;
  deadlines: {
    grace_hard_at: string | null;
    suspend_at: string | null;
    cancel_at: string | null;
  };
  invoices_overdue: Array<{
    id: number;
    invoice_number: string;
    amount_due: number;
    issued_at: string | null;
    period_start: string | null;
    period_end: string | null;
  }>;
  total_due: number;
  features_lost: string[];
  features_kept: string[];
  /**
   * S2.2 — set by backend when the store has no usable `state='active'` PM
   * (default invalidated, or no PM at all). Drives the "Actualizar método
   * de pago" CTA on the dunning board.
   */
  payment_method_invalid?: boolean;
}

export const loadDunningState = createAction(
  '[Subscription] Load Dunning State',
);

export const loadDunningStateSuccess = createAction(
  '[Subscription] Load Dunning State Success',
  props<{ dunning: DunningState }>(),
);

export const loadDunningStateFailure = createAction(
  '[Subscription] Load Dunning State Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const retryPayment = createAction('[Subscription] Retry Payment');

export const retryPaymentSuccess = createAction(
  '[Subscription] Retry Payment Success',
  props<{ result: { payment_id: number; invoice_id: number; state: string } }>(),
);

export const retryPaymentFailure = createAction(
  '[Subscription] Retry Payment Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

// S2.1 — Coupon redemption
//
// `appliedCoupon` is the local representation of a coupon that the user has
// validated and is about to redeem at checkout. It is wiped on
// `clearCoupon()`, on `subscriptionContextChanged()`, and on a successful
// `checkoutCommitSuccess` (the coupon has landed server-side and is now
// reflected in `current.promotional_plan_id`).

export interface AppliedCoupon {
  code: string;
  plan: {
    id: number;
    code: string;
    name: string;
    description: string | null;
    plan_type: string;
    base_price: string;
    currency: string;
    promo_priority: number;
  };
  overlay_features: Record<string, unknown>;
  duration_days: number | null;
  starts_at: string | null;
  expires_at: string | null;
}

export type CouponValidationReason =
  | 'not_found'
  | 'expired'
  | 'already_used'
  | 'not_eligible'
  | 'invalid_state';

export const validateCoupon = createAction(
  '[Subscription] Validate Coupon',
  props<{ code: string }>(),
);

export const validateCouponSuccess = createAction(
  '[Subscription] Validate Coupon Success',
  props<{ coupon: AppliedCoupon }>(),
);

export const validateCouponFailure = createAction(
  '[Subscription] Validate Coupon Failure',
  props<{ reason: CouponValidationReason; reasons_blocked?: string[] }>(),
);

export const validateCouponError = createAction(
  '[Subscription] Validate Coupon Error',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const clearCoupon = createAction('[Subscription] Clear Coupon');

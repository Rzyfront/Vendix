import { createReducer, on } from '@ngrx/store';
import * as SubscriptionActions from './subscription.actions';
import { DunningState, AppliedCoupon, CouponValidationReason } from './subscription.actions';
import { NormalizedApiPayload } from '../../utils/api-error-handler';

export interface SubscriptionState {
  current: any | null;
  status: string;
  daysUntilDue: number;
  featureMatrix: Record<string, any>;
  access: any | null;
  loaded: boolean;
  loading: boolean;
  error: NormalizedApiPayload | string | null;
  invoices: any[];
  preview: any | null;
  dunning: DunningState | null;
  retryingPayment: boolean;
  // S2.1 — Coupon redemption ephemeral state.
  appliedCoupon: AppliedCoupon | null;
  couponValidating: boolean;
  couponError: CouponValidationReason | string | null;
}

export const initialSubscriptionState: SubscriptionState = {
  current: null,
  status: 'none',
  daysUntilDue: 0,
  featureMatrix: {},
  access: null,
  loaded: false,
  loading: false,
  error: null,
  invoices: [],
  preview: null,
  dunning: null,
  retryingPayment: false,
  appliedCoupon: null,
  couponValidating: false,
  couponError: null,
};

export const subscriptionReducer = createReducer(
  initialSubscriptionState,

  // Sprint 1 / S1.2 — Wipe all subscription data when the active store
  // changes so the banner cannot flash the previous store's state while the
  // new fetch is in flight. `loaded:false` + `loading:true` makes the banner
  // selector return 'none' until loadCurrentSuccess arrives.
  on(SubscriptionActions.subscriptionContextChanged, (state, { storeId }) => ({
    ...initialSubscriptionState,
    loading: storeId !== null,
  })),

  on(SubscriptionActions.loadCurrent, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.loadCurrentSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? subscription?.state ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix:
      subscription?.resolved_features ??
      subscription?.featureMatrix ??
      state.featureMatrix,
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.loadCurrentFailure, (state, { error }) => ({
    ...state,
    current: null,
    status: 'none',
    loaded: true,
    loading: false,
    error,
  })),

  on(SubscriptionActions.loadAccess, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.loadAccessSuccess, (state, { access }) => ({
    ...state,
    access,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.loadAccessFailure, (state, { error }) => ({
    ...state,
    loaded: true,
    loading: false,
    error,
  })),

  on(SubscriptionActions.subscribe, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.subscribeSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? subscription?.state ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix:
      subscription?.resolved_features ??
      subscription?.featureMatrix ??
      state.featureMatrix,
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.subscribeFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.cancel, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.cancelSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? subscription?.state ?? state.status,
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.cancelFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.scheduleCancel, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.scheduleCancelSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? subscription?.state ?? state.status,
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.scheduleCancelFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.changePlan, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.changePlanSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? subscription?.state ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix:
      subscription?.resolved_features ??
      subscription?.featureMatrix ??
      state.featureMatrix,
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.changePlanFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.checkoutPreview, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.checkoutPreviewSuccess, (state, { preview }) => ({
    ...state,
    preview,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.checkoutPreviewFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.checkoutCommit, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.checkoutCommitSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? subscription?.state ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix:
      subscription?.resolved_features ??
      subscription?.featureMatrix ??
      state.featureMatrix,
    preview: null,
    loaded: true,
    loading: false,
    error: null,
    // S2.1 — Coupon has been applied server-side; wipe the ephemeral state so
    // it isn't double-redeemed on the next preview/commit.
    appliedCoupon: null,
    couponError: null,
  })),

  on(SubscriptionActions.checkoutCommitFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.loadInvoices, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.loadInvoicesSuccess, (state, { invoices }) => ({
    ...state,
    invoices,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.loadInvoicesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.loadSubscription, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.loadSubscriptionSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? subscription?.state ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix: subscription?.resolved_features ?? subscription?.featureMatrix ?? {},
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.loadSubscriptionFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.subscriptionUpdated, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? subscription?.state ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix: subscription?.resolved_features ?? subscription?.featureMatrix ?? state.featureMatrix,
    loaded: true,
    loading: false,
    error: null,
  })),

  // G6 — Dunning board

  on(SubscriptionActions.loadDunningState, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.loadDunningStateSuccess, (state, { dunning }) => ({
    ...state,
    dunning,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.loadDunningStateFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.retryPayment, (state) => ({
    ...state,
    retryingPayment: true,
    error: null,
  })),

  on(SubscriptionActions.retryPaymentSuccess, (state) => ({
    ...state,
    retryingPayment: false,
    error: null,
  })),

  on(SubscriptionActions.retryPaymentFailure, (state, { error }) => ({
    ...state,
    retryingPayment: false,
    error,
  })),

  // S2.1 — Coupon redemption

  on(SubscriptionActions.validateCoupon, (state) => ({
    ...state,
    couponValidating: true,
    couponError: null,
  })),

  on(SubscriptionActions.validateCouponSuccess, (state, { coupon }) => ({
    ...state,
    appliedCoupon: coupon,
    couponValidating: false,
    couponError: null,
  })),

  on(SubscriptionActions.validateCouponFailure, (state, { reason }) => ({
    ...state,
    appliedCoupon: null,
    couponValidating: false,
    couponError: reason,
  })),

  on(SubscriptionActions.validateCouponError, (state, { error }) => ({
    ...state,
    appliedCoupon: null,
    couponValidating: false,
    couponError: typeof error === 'string' ? error : 'network_error',
  })),

  on(SubscriptionActions.clearCoupon, (state) => ({
    ...state,
    appliedCoupon: null,
    couponError: null,
    couponValidating: false,
  })),
);

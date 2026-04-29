import { createSelector, createFeatureSelector } from '@ngrx/store';
import { SubscriptionState } from './subscription.reducer';

export const selectSubscriptionState =
  createFeatureSelector<SubscriptionState>('subscription');

export const selectCurrent = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.current,
);

export const selectStatus = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.status,
);

export const selectDaysUntilDue = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.daysUntilDue,
);

export const selectFeatureMatrix = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.featureMatrix,
);

export const selectAccess = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.access,
);

export const selectLoaded = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.loaded,
);

export const selectLoading = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.loading,
);

export const selectError = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.error,
);

export const selectInvoices = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.invoices,
);

export const selectPreview = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.preview,
);

export const selectDunning = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.dunning,
);

export const selectRetryingPayment = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.retryingPayment,
);

export const selectAppliedCoupon = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.appliedCoupon,
);

export const selectCouponValidating = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.couponValidating,
);

export const selectCouponError = createSelector(
  selectSubscriptionState,
  (state: SubscriptionState) => state.couponError,
);

export const selectScheduledCancelAt = createSelector(
  selectCurrent,
  (sub: any): string | null => sub?.scheduled_cancel_at ?? null,
);

export const selectBannerLevel = createSelector(
  selectStatus,
  selectDaysUntilDue,
  selectLoaded,
  selectScheduledCancelAt,
  (
    status: string,
    daysUntilDue: number,
    loaded: boolean,
    scheduledCancelAt: string | null,
  ): 'none' | 'info' | 'warning' | 'danger' | 'terminal' => {
    // S1.2 — Don't surface a level until we've actually loaded the new
    // store's subscription. This prevents the banner from flashing stale
    // data while a store-switch fetch is in flight.
    if (!loaded) return 'none';
    // Terminal lifecycle: cancelled/expired admit only a re-subscribe action,
    // not a "regularize payment" CTA. The banner branches accordingly.
    if (status === 'cancelled' || status === 'expired') return 'terminal';
    if (status === 'grace_hard' || status === 'grace_soft' || status === 'suspended') return 'danger';
    // Scheduled cancellation: plan is still alive (active/trial) but the user
    // turned off auto-renew with an end-of-cycle cancel. Surface as `warning`
    // (orange) — informative, not alarming, distinguishable from terminal red.
    if (
      scheduledCancelAt &&
      (status === 'active' || status === 'trialing' || status === 'trial')
    ) {
      return 'warning';
    }
    if (status === 'trialing' && daysUntilDue <= 3) return 'warning';
    if (status === 'trialing') return 'info';
    if (status === 'active' && daysUntilDue <= 7 && daysUntilDue > 0)
      return 'warning';
    return 'none';
  },
);

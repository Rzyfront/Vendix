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

export const selectBannerLevel = createSelector(
  selectStatus,
  selectDaysUntilDue,
  (
    status: string,
    daysUntilDue: number,
  ): 'none' | 'info' | 'warning' | 'danger' => {
    if (status === 'canceled' || status === 'expired') return 'danger';
    if (status === 'past_due') return 'danger';
    if (status === 'trialing' && daysUntilDue <= 3) return 'warning';
    if (status === 'trialing') return 'info';
    if (status === 'active' && daysUntilDue <= 7 && daysUntilDue > 0)
      return 'warning';
    return 'none';
  },
);

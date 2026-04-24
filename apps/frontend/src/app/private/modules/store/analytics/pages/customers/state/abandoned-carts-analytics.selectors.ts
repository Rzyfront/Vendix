import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AbandonedCartsAnalyticsState } from './abandoned-carts-analytics.state';

export const selectAbandonedCartsAnalyticsState =
  createFeatureSelector<AbandonedCartsAnalyticsState>('abandonedCartsAnalytics');

export const selectSummary = createSelector(
  selectAbandonedCartsAnalyticsState,
  (state) => state.summary,
);

export const selectTrends = createSelector(
  selectAbandonedCartsAnalyticsState,
  (state) => state.trends,
);

export const selectByReason = createSelector(
  selectAbandonedCartsAnalyticsState,
  (state) => state.byReason,
);

export const selectLoading = createSelector(
  selectAbandonedCartsAnalyticsState,
  (state) => state.loading,
);

export const selectLoadingTrends = createSelector(
  selectAbandonedCartsAnalyticsState,
  (state) => state.loadingTrends,
);

export const selectExporting = createSelector(
  selectAbandonedCartsAnalyticsState,
  (state) => state.exporting,
);

export const selectDateRange = createSelector(
  selectAbandonedCartsAnalyticsState,
  (state) => state.dateRange,
);

export const selectGranularity = createSelector(
  selectAbandonedCartsAnalyticsState,
  (state) => state.granularity,
);

export const selectError = createSelector(
  selectAbandonedCartsAnalyticsState,
  (state) => state.error,
);

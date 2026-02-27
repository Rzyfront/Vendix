import { createFeatureSelector, createSelector } from '@ngrx/store';
import { CustomersAnalyticsState } from './customers-analytics.state';

export const selectCustomersAnalyticsState =
  createFeatureSelector<CustomersAnalyticsState>('customersAnalytics');

export const selectSummary = createSelector(
  selectCustomersAnalyticsState,
  (state) => state.summary,
);

export const selectTrends = createSelector(
  selectCustomersAnalyticsState,
  (state) => state.trends,
);

export const selectTopCustomers = createSelector(
  selectCustomersAnalyticsState,
  (state) => state.topCustomers,
);

export const selectLoading = createSelector(
  selectCustomersAnalyticsState,
  (state) => state.loading,
);

export const selectLoadingTrends = createSelector(
  selectCustomersAnalyticsState,
  (state) => state.loadingTrends,
);

export const selectExporting = createSelector(
  selectCustomersAnalyticsState,
  (state) => state.exporting,
);

export const selectDateRange = createSelector(
  selectCustomersAnalyticsState,
  (state) => state.dateRange,
);

export const selectGranularity = createSelector(
  selectCustomersAnalyticsState,
  (state) => state.granularity,
);

export const selectError = createSelector(
  selectCustomersAnalyticsState,
  (state) => state.error,
);

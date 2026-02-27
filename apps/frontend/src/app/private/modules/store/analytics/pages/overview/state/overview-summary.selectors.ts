import { createFeatureSelector, createSelector } from '@ngrx/store';
import { OverviewSummaryState } from './overview-summary.state';

export const selectOverviewSummaryState =
  createFeatureSelector<OverviewSummaryState>('overviewSummary');

export const selectSummary = createSelector(
  selectOverviewSummaryState,
  (state) => state.summary,
);

export const selectTrends = createSelector(
  selectOverviewSummaryState,
  (state) => state.trends,
);

export const selectLoading = createSelector(
  selectOverviewSummaryState,
  (state) => state.loading,
);

export const selectLoadingTrends = createSelector(
  selectOverviewSummaryState,
  (state) => state.loadingTrends,
);

export const selectDateRange = createSelector(
  selectOverviewSummaryState,
  (state) => state.dateRange,
);

export const selectGranularity = createSelector(
  selectOverviewSummaryState,
  (state) => state.granularity,
);

export const selectError = createSelector(
  selectOverviewSummaryState,
  (state) => state.error,
);

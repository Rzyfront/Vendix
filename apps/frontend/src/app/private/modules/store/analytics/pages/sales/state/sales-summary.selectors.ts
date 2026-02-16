import { createFeatureSelector, createSelector } from '@ngrx/store';
import { SalesSummaryState } from './sales-summary.state';

export const selectSalesSummaryState =
  createFeatureSelector<SalesSummaryState>('salesSummary');

export const selectSummary = createSelector(
  selectSalesSummaryState,
  (state) => state.summary,
);

export const selectTrends = createSelector(
  selectSalesSummaryState,
  (state) => state.trends,
);

export const selectLoading = createSelector(
  selectSalesSummaryState,
  (state) => state.loading,
);

export const selectLoadingTrends = createSelector(
  selectSalesSummaryState,
  (state) => state.loadingTrends,
);

export const selectExporting = createSelector(
  selectSalesSummaryState,
  (state) => state.exporting,
);

export const selectDateRange = createSelector(
  selectSalesSummaryState,
  (state) => state.dateRange,
);

export const selectGranularity = createSelector(
  selectSalesSummaryState,
  (state) => state.granularity,
);

export const selectChannel = createSelector(
  selectSalesSummaryState,
  (state) => state.channel,
);

export const selectError = createSelector(
  selectSalesSummaryState,
  (state) => state.error,
);

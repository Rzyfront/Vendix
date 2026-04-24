import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ProfitabilityAnalyticsState } from './profitability-analytics.state';

export const selectProfitabilityAnalyticsState =
  createFeatureSelector<ProfitabilityAnalyticsState>('profitabilityAnalytics');

export const selectProfitabilityProducts = createSelector(
  selectProfitabilityAnalyticsState,
  (state) => state.products,
);

export const selectProfitabilitySummary = createSelector(
  selectProfitabilityAnalyticsState,
  (state) => state.summary,
);

export const selectProfitabilityDateRange = createSelector(
  selectProfitabilityAnalyticsState,
  (state) => state.dateRange,
);

export const selectProfitabilityGranularity = createSelector(
  selectProfitabilityAnalyticsState,
  (state) => state.granularity,
);

export const selectProfitabilityLoading = createSelector(
  selectProfitabilityAnalyticsState,
  (state) => state.loading,
);

export const selectProfitabilityExporting = createSelector(
  selectProfitabilityAnalyticsState,
  (state) => state.exporting,
);

export const selectProfitabilityError = createSelector(
  selectProfitabilityAnalyticsState,
  (state) => state.error,
);

export const selectProfitableProducts = createSelector(
  selectProfitabilityProducts,
  (products) => products.filter((p) => p.profit > 0),
);

export const selectUnprofitableProducts = createSelector(
  selectProfitabilityProducts,
  (products) => products.filter((p) => p.profit <= 0),
);

export const selectTopProfitableProducts = createSelector(
  selectProfitabilityProducts,
  (products) => [...products].sort((a, b) => b.profit - a.profit).slice(0, 5),
);

export const selectMostProfitableByMargin = createSelector(
  selectProfitabilityProducts,
  (products) =>
    [...products]
      .filter((p) => p.margin > 0)
      .sort((a, b) => b.margin - a.margin)[0] || null,
);

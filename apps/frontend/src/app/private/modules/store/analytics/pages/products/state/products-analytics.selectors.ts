import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ProductsAnalyticsState } from './products-analytics.state';

export const selectProductsAnalyticsState =
  createFeatureSelector<ProductsAnalyticsState>('productsAnalytics');

export const selectSummary = createSelector(
  selectProductsAnalyticsState,
  (state) => state.summary,
);

export const selectTopSellers = createSelector(
  selectProductsAnalyticsState,
  (state) => state.topSellers,
);

export const selectTrends = createSelector(
  selectProductsAnalyticsState,
  (state) => state.trends,
);

export const selectGranularity = createSelector(
  selectProductsAnalyticsState,
  (state) => state.granularity,
);

export const selectLoadingTrends = createSelector(
  selectProductsAnalyticsState,
  (state) => state.loadingTrends,
);

export const selectProducts = createSelector(
  selectProductsAnalyticsState,
  (state) => state.products,
);

export const selectTotalProducts = createSelector(
  selectProductsAnalyticsState,
  (state) => state.totalProducts,
);

export const selectLoading = createSelector(
  selectProductsAnalyticsState,
  (state) => state.loading,
);

export const selectLoadingTopSellers = createSelector(
  selectProductsAnalyticsState,
  (state) => state.loadingTopSellers,
);

export const selectLoadingTable = createSelector(
  selectProductsAnalyticsState,
  (state) => state.loadingTable,
);

export const selectExporting = createSelector(
  selectProductsAnalyticsState,
  (state) => state.exporting,
);

export const selectDateRange = createSelector(
  selectProductsAnalyticsState,
  (state) => state.dateRange,
);

export const selectSearch = createSelector(
  selectProductsAnalyticsState,
  (state) => state.search,
);

export const selectPage = createSelector(
  selectProductsAnalyticsState,
  (state) => state.page,
);

export const selectLimit = createSelector(
  selectProductsAnalyticsState,
  (state) => state.limit,
);

export const selectSortBy = createSelector(
  selectProductsAnalyticsState,
  (state) => state.sortBy,
);

export const selectSortOrder = createSelector(
  selectProductsAnalyticsState,
  (state) => state.sortOrder,
);

export const selectError = createSelector(
  selectProductsAnalyticsState,
  (state) => state.error,
);

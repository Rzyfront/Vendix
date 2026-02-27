import { createFeatureSelector, createSelector } from '@ngrx/store';
import { InventoryOverviewState } from './inventory-overview.state';

export const selectInventoryOverviewState =
  createFeatureSelector<InventoryOverviewState>('inventoryOverview');

export const selectSummary = createSelector(
  selectInventoryOverviewState,
  (state) => state.summary,
);

export const selectMovementTrends = createSelector(
  selectInventoryOverviewState,
  (state) => state.movementTrends,
);

export const selectMovementSummary = createSelector(
  selectInventoryOverviewState,
  (state) => state.movementSummary,
);

export const selectValuations = createSelector(
  selectInventoryOverviewState,
  (state) => state.valuations,
);

export const selectLoading = createSelector(
  selectInventoryOverviewState,
  (state) => state.loading,
);

export const selectLoadingTrends = createSelector(
  selectInventoryOverviewState,
  (state) => state.loadingTrends,
);

export const selectLoadingValuation = createSelector(
  selectInventoryOverviewState,
  (state) => state.loadingValuation,
);

export const selectExporting = createSelector(
  selectInventoryOverviewState,
  (state) => state.exporting,
);

export const selectDateRange = createSelector(
  selectInventoryOverviewState,
  (state) => state.dateRange,
);

export const selectGranularity = createSelector(
  selectInventoryOverviewState,
  (state) => state.granularity,
);

export const selectLocationId = createSelector(
  selectInventoryOverviewState,
  (state) => state.locationId,
);

export const selectError = createSelector(
  selectInventoryOverviewState,
  (state) => state.error,
);

// Computed selectors for percentage texts
export const selectLowStockPercentage = createSelector(
  selectSummary,
  (summary) => summary ? summary.low_stock_percentage.toFixed(1) : '0',
);

export const selectOutOfStockPercentage = createSelector(
  selectSummary,
  (summary) => summary ? summary.out_of_stock_percentage.toFixed(1) : '0',
);

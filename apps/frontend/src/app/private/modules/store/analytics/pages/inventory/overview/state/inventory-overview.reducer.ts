import { createReducer, on } from '@ngrx/store';
import { InventoryOverviewState, initialInventoryOverviewState } from './inventory-overview.state';
import * as InventoryActions from './inventory-overview.actions';

export const inventoryOverviewReducer = createReducer(
  initialInventoryOverviewState,

  // Filters
  on(InventoryActions.setDateRange, (state, { dateRange }) => ({
    ...state,
    dateRange,
  })),
  on(InventoryActions.setGranularity, (state, { granularity }) => ({
    ...state,
    granularity,
  })),
  on(InventoryActions.setLocationId, (state, { locationId }) => ({
    ...state,
    locationId,
  })),

  // Load Summary
  on(InventoryActions.loadInventorySummary, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InventoryActions.loadInventorySummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    loading: false,
    error: null,
  })),
  on(InventoryActions.loadInventorySummaryFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // Load Movement Trends
  on(InventoryActions.loadMovementTrends, (state) => ({
    ...state,
    loadingTrends: true,
    error: null,
  })),
  on(InventoryActions.loadMovementTrendsSuccess, (state, { trends }) => ({
    ...state,
    movementTrends: trends,
    loadingTrends: false,
    error: null,
  })),
  on(InventoryActions.loadMovementTrendsFailure, (state, { error }) => ({
    ...state,
    loadingTrends: false,
    error,
  })),

  // Load Movement Summary
  on(InventoryActions.loadMovementSummary, (state) => ({
    ...state,
    loadingTrends: true,
    error: null,
  })),
  on(InventoryActions.loadMovementSummarySuccess, (state, { movementSummary }) => ({
    ...state,
    movementSummary,
    loadingTrends: false,
    error: null,
  })),
  on(InventoryActions.loadMovementSummaryFailure, (state, { error }) => ({
    ...state,
    loadingTrends: false,
    error,
  })),

  // Load Valuations
  on(InventoryActions.loadValuations, (state) => ({
    ...state,
    loadingValuation: true,
    error: null,
  })),
  on(InventoryActions.loadValuationsSuccess, (state, { valuations }) => ({
    ...state,
    valuations,
    loadingValuation: false,
    error: null,
  })),
  on(InventoryActions.loadValuationsFailure, (state, { error }) => ({
    ...state,
    loadingValuation: false,
    error,
  })),

  // Export
  on(InventoryActions.exportInventoryReport, (state) => ({
    ...state,
    exporting: true,
  })),
  on(InventoryActions.exportInventoryReportSuccess, (state) => ({
    ...state,
    exporting: false,
  })),
  on(InventoryActions.exportInventoryReportFailure, (state, { error }) => ({
    ...state,
    exporting: false,
    error,
  })),

  // Clear
  on(InventoryActions.clearInventoryOverviewState, () => initialInventoryOverviewState),
);

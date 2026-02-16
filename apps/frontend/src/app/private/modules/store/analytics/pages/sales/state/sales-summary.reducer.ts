import { createReducer, on } from '@ngrx/store';
import { SalesSummaryState, initialSalesSummaryState } from './sales-summary.state';
import * as SalesActions from './sales-summary.actions';

export const salesSummaryReducer = createReducer(
  initialSalesSummaryState,

  // Filters
  on(SalesActions.setDateRange, (state, { dateRange }) => ({
    ...state,
    dateRange,
  })),
  on(SalesActions.setGranularity, (state, { granularity }) => ({
    ...state,
    granularity,
  })),
  on(SalesActions.setChannel, (state, { channel }) => ({
    ...state,
    channel,
  })),

  // Load Summary
  on(SalesActions.loadSalesSummary, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(SalesActions.loadSalesSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    loading: false,
    error: null,
  })),
  on(SalesActions.loadSalesSummaryFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // Load Trends
  on(SalesActions.loadSalesTrends, (state) => ({
    ...state,
    loadingTrends: true,
    error: null,
  })),
  on(SalesActions.loadSalesTrendsSuccess, (state, { trends }) => ({
    ...state,
    trends,
    loadingTrends: false,
    error: null,
  })),
  on(SalesActions.loadSalesTrendsFailure, (state, { error }) => ({
    ...state,
    loadingTrends: false,
    error,
  })),

  // Export
  on(SalesActions.exportSalesReport, (state) => ({
    ...state,
    exporting: true,
  })),
  on(SalesActions.exportSalesReportSuccess, (state) => ({
    ...state,
    exporting: false,
  })),
  on(SalesActions.exportSalesReportFailure, (state, { error }) => ({
    ...state,
    exporting: false,
    error,
  })),

  // Clear
  on(SalesActions.clearSalesSummaryState, () => initialSalesSummaryState),
);

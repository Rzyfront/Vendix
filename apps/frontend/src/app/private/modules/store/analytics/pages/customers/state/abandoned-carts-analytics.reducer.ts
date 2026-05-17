import { createReducer, on } from '@ngrx/store';
import { AbandonedCartsAnalyticsState, initialAbandonedCartsAnalyticsState } from './abandoned-carts-analytics.state';
import * as AbandonedCartsActions from './abandoned-carts-analytics.actions';

export const abandonedCartsAnalyticsReducer = createReducer(
  initialAbandonedCartsAnalyticsState,

  on(AbandonedCartsActions.setDateRange, (state, { dateRange }) => ({
    ...state,
    dateRange,
  })),
  on(AbandonedCartsActions.setGranularity, (state, { granularity }) => ({
    ...state,
    granularity,
  })),

  on(AbandonedCartsActions.loadAbandonedCartsSummary, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(AbandonedCartsActions.loadAbandonedCartsSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    loading: false,
    error: null,
  })),
  on(AbandonedCartsActions.loadAbandonedCartsSummaryFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(AbandonedCartsActions.loadAbandonedCartsTrends, (state) => ({
    ...state,
    loadingTrends: true,
    error: null,
  })),
  on(AbandonedCartsActions.loadAbandonedCartsTrendsSuccess, (state, { trends }) => ({
    ...state,
    trends,
    loadingTrends: false,
    error: null,
  })),
  on(AbandonedCartsActions.loadAbandonedCartsTrendsFailure, (state, { error }) => ({
    ...state,
    loadingTrends: false,
    error,
  })),

  on(AbandonedCartsActions.loadAbandonedCartsByReason, (state) => ({
    ...state,
    loadingTrends: true,
    error: null,
  })),
  on(AbandonedCartsActions.loadAbandonedCartsByReasonSuccess, (state, { byReason }) => ({
    ...state,
    byReason,
    loadingTrends: false,
    error: null,
  })),
  on(AbandonedCartsActions.loadAbandonedCartsByReasonFailure, (state, { error }) => ({
    ...state,
    loadingTrends: false,
    error,
  })),

  on(AbandonedCartsActions.exportAbandonedCartsReport, (state) => ({
    ...state,
    exporting: true,
  })),
  on(AbandonedCartsActions.exportAbandonedCartsReportSuccess, (state) => ({
    ...state,
    exporting: false,
  })),
  on(AbandonedCartsActions.exportAbandonedCartsReportFailure, (state, { error }) => ({
    ...state,
    exporting: false,
    error,
  })),

  on(AbandonedCartsActions.clearAbandonedCartsAnalyticsState, () => initialAbandonedCartsAnalyticsState),
);

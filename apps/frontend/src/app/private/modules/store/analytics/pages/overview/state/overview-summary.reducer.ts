import { createReducer, on } from '@ngrx/store';
import { OverviewSummaryState, initialOverviewSummaryState } from './overview-summary.state';
import * as OverviewActions from './overview-summary.actions';

export const overviewSummaryReducer = createReducer(
  initialOverviewSummaryState,

  // Filters
  on(OverviewActions.setDateRange, (state, { dateRange }) => ({
    ...state,
    dateRange,
  })),
  on(OverviewActions.setGranularity, (state, { granularity }) => ({
    ...state,
    granularity,
  })),

  // Load Summary
  on(OverviewActions.loadOverviewSummary, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(OverviewActions.loadOverviewSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    loading: false,
    error: null,
  })),
  on(OverviewActions.loadOverviewSummaryFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // Load Trends
  on(OverviewActions.loadOverviewTrends, (state) => ({
    ...state,
    loadingTrends: true,
    error: null,
  })),
  on(OverviewActions.loadOverviewTrendsSuccess, (state, { trends }) => ({
    ...state,
    trends,
    loadingTrends: false,
    error: null,
  })),
  on(OverviewActions.loadOverviewTrendsFailure, (state, { error }) => ({
    ...state,
    loadingTrends: false,
    error,
  })),

  // Clear
  on(OverviewActions.clearOverviewSummaryState, () => initialOverviewSummaryState),
);

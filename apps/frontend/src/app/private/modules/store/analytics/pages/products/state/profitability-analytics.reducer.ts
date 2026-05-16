import { createReducer, on } from '@ngrx/store';
import { ProfitabilityAnalyticsState, initialProfitabilityAnalyticsState } from './profitability-analytics.state';
import * as ProfitabilityActions from './profitability-analytics.actions';

export const profitabilityAnalyticsReducer = createReducer(
  initialProfitabilityAnalyticsState,

  on(ProfitabilityActions.setProfitabilityDateRange, (state, { dateRange }) => ({
    ...state,
    dateRange,
  })),

  on(ProfitabilityActions.setProfitabilityGranularity, (state, { granularity }) => ({
    ...state,
    granularity,
  })),

  on(ProfitabilityActions.loadProfitability, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(ProfitabilityActions.loadProfitabilitySuccess, (state, { products, summary }) => ({
    ...state,
    products,
    summary,
    loading: false,
    error: null,
  })),

  on(ProfitabilityActions.loadProfitabilityFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(ProfitabilityActions.exportProfitabilityReport, (state) => ({
    ...state,
    exporting: true,
  })),

  on(ProfitabilityActions.exportProfitabilityReportSuccess, (state) => ({
    ...state,
    exporting: false,
  })),

  on(ProfitabilityActions.exportProfitabilityReportFailure, (state, { error }) => ({
    ...state,
    exporting: false,
    error,
  })),

  on(ProfitabilityActions.clearProfitabilityAnalyticsState, () => initialProfitabilityAnalyticsState),
);

import { createReducer, on } from '@ngrx/store';
import { CustomersAnalyticsState, initialCustomersAnalyticsState } from './customers-analytics.state';
import * as CustomersActions from './customers-analytics.actions';

export const customersAnalyticsReducer = createReducer(
  initialCustomersAnalyticsState,

  // Filters
  on(CustomersActions.setDateRange, (state, { dateRange }) => ({
    ...state,
    dateRange,
  })),
  on(CustomersActions.setGranularity, (state, { granularity }) => ({
    ...state,
    granularity,
  })),

  // Load Summary
  on(CustomersActions.loadCustomersSummary, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(CustomersActions.loadCustomersSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    loading: false,
    error: null,
  })),
  on(CustomersActions.loadCustomersSummaryFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // Load Trends
  on(CustomersActions.loadCustomersTrends, (state) => ({
    ...state,
    loadingTrends: true,
    error: null,
  })),
  on(CustomersActions.loadCustomersTrendsSuccess, (state, { trends }) => ({
    ...state,
    trends,
    loadingTrends: false,
    error: null,
  })),
  on(CustomersActions.loadCustomersTrendsFailure, (state, { error }) => ({
    ...state,
    loadingTrends: false,
    error,
  })),

  // Load Top Customers
  on(CustomersActions.loadTopCustomers, (state) => ({
    ...state,
    loadingTrends: true,
    error: null,
  })),
  on(CustomersActions.loadTopCustomersSuccess, (state, { topCustomers }) => ({
    ...state,
    topCustomers,
    loadingTrends: false,
    error: null,
  })),
  on(CustomersActions.loadTopCustomersFailure, (state, { error }) => ({
    ...state,
    loadingTrends: false,
    error,
  })),

  // Export
  on(CustomersActions.exportCustomersReport, (state) => ({
    ...state,
    exporting: true,
  })),
  on(CustomersActions.exportCustomersReportSuccess, (state) => ({
    ...state,
    exporting: false,
  })),
  on(CustomersActions.exportCustomersReportFailure, (state, { error }) => ({
    ...state,
    exporting: false,
    error,
  })),

  // Clear
  on(CustomersActions.clearCustomersAnalyticsState, () => initialCustomersAnalyticsState),
);

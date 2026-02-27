import { createAction, props } from '@ngrx/store';
import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { CustomersSummary, CustomerTrend, TopCustomer } from '../../../interfaces/customers-analytics.interface';

// Filters
export const setDateRange = createAction(
  '[Customers Analytics] Set Date Range',
  props<{ dateRange: DateRangeFilter }>(),
);
export const setGranularity = createAction(
  '[Customers Analytics] Set Granularity',
  props<{ granularity: string }>(),
);

// Load Summary
export const loadCustomersSummary = createAction('[Customers Analytics] Load Summary');
export const loadCustomersSummarySuccess = createAction(
  '[Customers Analytics] Load Summary Success',
  props<{ summary: CustomersSummary }>(),
);
export const loadCustomersSummaryFailure = createAction(
  '[Customers Analytics] Load Summary Failure',
  props<{ error: string }>(),
);

// Load Trends
export const loadCustomersTrends = createAction('[Customers Analytics] Load Trends');
export const loadCustomersTrendsSuccess = createAction(
  '[Customers Analytics] Load Trends Success',
  props<{ trends: CustomerTrend[] }>(),
);
export const loadCustomersTrendsFailure = createAction(
  '[Customers Analytics] Load Trends Failure',
  props<{ error: string }>(),
);

// Load Top Customers
export const loadTopCustomers = createAction('[Customers Analytics] Load Top Customers');
export const loadTopCustomersSuccess = createAction(
  '[Customers Analytics] Load Top Customers Success',
  props<{ topCustomers: TopCustomer[] }>(),
);
export const loadTopCustomersFailure = createAction(
  '[Customers Analytics] Load Top Customers Failure',
  props<{ error: string }>(),
);

// Export
export const exportCustomersReport = createAction('[Customers Analytics] Export Report');
export const exportCustomersReportSuccess = createAction('[Customers Analytics] Export Report Success');
export const exportCustomersReportFailure = createAction(
  '[Customers Analytics] Export Report Failure',
  props<{ error: string }>(),
);

// Clear
export const clearCustomersAnalyticsState = createAction('[Customers Analytics] Clear State');

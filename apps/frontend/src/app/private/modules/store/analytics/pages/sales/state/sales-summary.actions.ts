import { createAction, props } from '@ngrx/store';
import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { SalesSummary, SalesTrend } from '../../../interfaces/sales-analytics.interface';

// Filters
export const setDateRange = createAction(
  '[Sales Summary] Set Date Range',
  props<{ dateRange: DateRangeFilter }>(),
);
export const setGranularity = createAction(
  '[Sales Summary] Set Granularity',
  props<{ granularity: string }>(),
);
export const setChannel = createAction(
  '[Sales Summary] Set Channel',
  props<{ channel: string }>(),
);

// Load Summary
export const loadSalesSummary = createAction('[Sales Summary] Load Sales Summary');
export const loadSalesSummarySuccess = createAction(
  '[Sales Summary] Load Sales Summary Success',
  props<{ summary: SalesSummary }>(),
);
export const loadSalesSummaryFailure = createAction(
  '[Sales Summary] Load Sales Summary Failure',
  props<{ error: string }>(),
);

// Load Trends
export const loadSalesTrends = createAction('[Sales Summary] Load Sales Trends');
export const loadSalesTrendsSuccess = createAction(
  '[Sales Summary] Load Sales Trends Success',
  props<{ trends: SalesTrend[] }>(),
);
export const loadSalesTrendsFailure = createAction(
  '[Sales Summary] Load Sales Trends Failure',
  props<{ error: string }>(),
);

// Export
export const exportSalesReport = createAction('[Sales Summary] Export Sales Report');
export const exportSalesReportSuccess = createAction('[Sales Summary] Export Sales Report Success');
export const exportSalesReportFailure = createAction(
  '[Sales Summary] Export Sales Report Failure',
  props<{ error: string }>(),
);

// Clear
export const clearSalesSummaryState = createAction('[Sales Summary] Clear State');

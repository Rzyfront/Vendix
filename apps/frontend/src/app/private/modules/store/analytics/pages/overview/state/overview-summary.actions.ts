import { createAction, props } from '@ngrx/store';
import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { OverviewSummary, OverviewTrend } from '../../../interfaces/overview-analytics.interface';

// Filters
export const setDateRange = createAction(
  '[Overview Summary] Set Date Range',
  props<{ dateRange: DateRangeFilter }>(),
);
export const setGranularity = createAction(
  '[Overview Summary] Set Granularity',
  props<{ granularity: string }>(),
);

// Load Summary
export const loadOverviewSummary = createAction('[Overview Summary] Load Overview Summary');
export const loadOverviewSummarySuccess = createAction(
  '[Overview Summary] Load Overview Summary Success',
  props<{ summary: OverviewSummary }>(),
);
export const loadOverviewSummaryFailure = createAction(
  '[Overview Summary] Load Overview Summary Failure',
  props<{ error: string }>(),
);

// Load Trends
export const loadOverviewTrends = createAction('[Overview Summary] Load Overview Trends');
export const loadOverviewTrendsSuccess = createAction(
  '[Overview Summary] Load Overview Trends Success',
  props<{ trends: OverviewTrend[] }>(),
);
export const loadOverviewTrendsFailure = createAction(
  '[Overview Summary] Load Overview Trends Failure',
  props<{ error: string }>(),
);

// Clear
export const clearOverviewSummaryState = createAction('[Overview Summary] Clear State');

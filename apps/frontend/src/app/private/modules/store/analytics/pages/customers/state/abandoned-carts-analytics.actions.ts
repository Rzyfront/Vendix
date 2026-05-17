import { createAction, props } from '@ngrx/store';
import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import {
  AbandonedCartsSummary,
  AbandonedCartTrend,
  AbandonedCartByReason,
} from '../../../interfaces/abandoned-carts-analytics.interface';

export const setDateRange = createAction(
  '[Abandoned Carts Analytics] Set Date Range',
  props<{ dateRange: DateRangeFilter }>(),
);
export const setGranularity = createAction(
  '[Abandoned Carts Analytics] Set Granularity',
  props<{ granularity: string }>(),
);

export const loadAbandonedCartsSummary = createAction(
  '[Abandoned Carts Analytics] Load Summary',
);
export const loadAbandonedCartsSummarySuccess = createAction(
  '[Abandoned Carts Analytics] Load Summary Success',
  props<{ summary: AbandonedCartsSummary }>(),
);
export const loadAbandonedCartsSummaryFailure = createAction(
  '[Abandoned Carts Analytics] Load Summary Failure',
  props<{ error: string }>(),
);

export const loadAbandonedCartsTrends = createAction(
  '[Abandoned Carts Analytics] Load Trends',
);
export const loadAbandonedCartsTrendsSuccess = createAction(
  '[Abandoned Carts Analytics] Load Trends Success',
  props<{ trends: AbandonedCartTrend[] }>(),
);
export const loadAbandonedCartsTrendsFailure = createAction(
  '[Abandoned Carts Analytics] Load Trends Failure',
  props<{ error: string }>(),
);

export const loadAbandonedCartsByReason = createAction(
  '[Abandoned Carts Analytics] Load By Reason',
);
export const loadAbandonedCartsByReasonSuccess = createAction(
  '[Abandoned Carts Analytics] Load By Reason Success',
  props<{ byReason: AbandonedCartByReason[] }>(),
);
export const loadAbandonedCartsByReasonFailure = createAction(
  '[Abandoned Carts Analytics] Load By Reason Failure',
  props<{ error: string }>(),
);

export const exportAbandonedCartsReport = createAction(
  '[Abandoned Carts Analytics] Export Report',
);
export const exportAbandonedCartsReportSuccess = createAction(
  '[Abandoned Carts Analytics] Export Report Success',
);
export const exportAbandonedCartsReportFailure = createAction(
  '[Abandoned Carts Analytics] Export Report Failure',
  props<{ error: string }>(),
);

export const clearAbandonedCartsAnalyticsState = createAction(
  '[Abandoned Carts Analytics] Clear State',
);

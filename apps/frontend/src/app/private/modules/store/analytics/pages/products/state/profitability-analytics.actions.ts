import { createAction, props } from '@ngrx/store';
import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { ProductProfitability, ProfitabilitySummary } from '../../../interfaces/products-analytics.interface';

export const setProfitabilityDateRange = createAction(
  '[Profitability Analytics] Set Date Range',
  props<{ dateRange: DateRangeFilter }>(),
);

export const setProfitabilityGranularity = createAction(
  '[Profitability Analytics] Set Granularity',
  props<{ granularity: string }>(),
);

export const loadProfitability = createAction('[Profitability Analytics] Load');

export const loadProfitabilitySuccess = createAction(
  '[Profitability Analytics] Load Success',
  props<{ products: ProductProfitability[]; summary: ProfitabilitySummary }>(),
);

export const loadProfitabilityFailure = createAction(
  '[Profitability Analytics] Load Failure',
  props<{ error: string }>(),
);

export const exportProfitabilityReport = createAction('[Profitability Analytics] Export Report');

export const exportProfitabilityReportSuccess = createAction('[Profitability Analytics] Export Report Success');

export const exportProfitabilityReportFailure = createAction(
  '[Profitability Analytics] Export Report Failure',
  props<{ error: string }>(),
);

export const clearProfitabilityAnalyticsState = createAction('[Profitability Analytics] Clear State');

import { createAction, props } from '@ngrx/store';
import { DateRangeFilter } from '../../../../interfaces/analytics.interface';
import {
  InventorySummary,
  MovementTrend,
  MovementSummaryItem,
  InventoryValuation,
} from '../../../../interfaces/inventory-analytics.interface';

// Filters
export const setDateRange = createAction(
  '[Inventory Overview] Set Date Range',
  props<{ dateRange: DateRangeFilter }>(),
);
export const setGranularity = createAction(
  '[Inventory Overview] Set Granularity',
  props<{ granularity: string }>(),
);
export const setLocationId = createAction(
  '[Inventory Overview] Set Location Id',
  props<{ locationId: number | null }>(),
);

// Load Summary
export const loadInventorySummary = createAction('[Inventory Overview] Load Summary');
export const loadInventorySummarySuccess = createAction(
  '[Inventory Overview] Load Summary Success',
  props<{ summary: InventorySummary }>(),
);
export const loadInventorySummaryFailure = createAction(
  '[Inventory Overview] Load Summary Failure',
  props<{ error: string }>(),
);

// Load Movement Trends
export const loadMovementTrends = createAction('[Inventory Overview] Load Movement Trends');
export const loadMovementTrendsSuccess = createAction(
  '[Inventory Overview] Load Movement Trends Success',
  props<{ trends: MovementTrend[] }>(),
);
export const loadMovementTrendsFailure = createAction(
  '[Inventory Overview] Load Movement Trends Failure',
  props<{ error: string }>(),
);

// Load Movement Summary
export const loadMovementSummary = createAction('[Inventory Overview] Load Movement Summary');
export const loadMovementSummarySuccess = createAction(
  '[Inventory Overview] Load Movement Summary Success',
  props<{ movementSummary: MovementSummaryItem[] }>(),
);
export const loadMovementSummaryFailure = createAction(
  '[Inventory Overview] Load Movement Summary Failure',
  props<{ error: string }>(),
);

// Load Valuations
export const loadValuations = createAction('[Inventory Overview] Load Valuations');
export const loadValuationsSuccess = createAction(
  '[Inventory Overview] Load Valuations Success',
  props<{ valuations: InventoryValuation[] }>(),
);
export const loadValuationsFailure = createAction(
  '[Inventory Overview] Load Valuations Failure',
  props<{ error: string }>(),
);

// Export
export const exportInventoryReport = createAction('[Inventory Overview] Export Report');
export const exportInventoryReportSuccess = createAction('[Inventory Overview] Export Report Success');
export const exportInventoryReportFailure = createAction(
  '[Inventory Overview] Export Report Failure',
  props<{ error: string }>(),
);

// Clear
export const clearInventoryOverviewState = createAction('[Inventory Overview] Clear State');

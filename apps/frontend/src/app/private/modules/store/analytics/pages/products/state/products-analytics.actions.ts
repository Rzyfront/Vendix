import { createAction, props } from '@ngrx/store';
import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { ProductsSummary, TopSellingProduct, ProductAnalyticsRow } from '../../../interfaces/products-analytics.interface';

// Filters
export const setDateRange = createAction(
  '[Products Analytics] Set Date Range',
  props<{ dateRange: DateRangeFilter }>(),
);
export const setSearch = createAction(
  '[Products Analytics] Set Search',
  props<{ search: string }>(),
);
export const setPage = createAction(
  '[Products Analytics] Set Page',
  props<{ page: number }>(),
);
export const setSort = createAction(
  '[Products Analytics] Set Sort',
  props<{ sortBy: string; sortOrder: 'asc' | 'desc' }>(),
);

// Load Summary
export const loadProductsSummary = createAction('[Products Analytics] Load Summary');
export const loadProductsSummarySuccess = createAction(
  '[Products Analytics] Load Summary Success',
  props<{ summary: ProductsSummary }>(),
);
export const loadProductsSummaryFailure = createAction(
  '[Products Analytics] Load Summary Failure',
  props<{ error: string }>(),
);

// Load Top Sellers
export const loadTopSellers = createAction('[Products Analytics] Load Top Sellers');
export const loadTopSellersSuccess = createAction(
  '[Products Analytics] Load Top Sellers Success',
  props<{ topSellers: TopSellingProduct[] }>(),
);
export const loadTopSellersFailure = createAction(
  '[Products Analytics] Load Top Sellers Failure',
  props<{ error: string }>(),
);

// Load Products Table
export const loadProductsTable = createAction('[Products Analytics] Load Products Table');
export const loadProductsTableSuccess = createAction(
  '[Products Analytics] Load Products Table Success',
  props<{ products: ProductAnalyticsRow[]; total: number }>(),
);
export const loadProductsTableFailure = createAction(
  '[Products Analytics] Load Products Table Failure',
  props<{ error: string }>(),
);

// Export
export const exportProductsReport = createAction('[Products Analytics] Export Report');
export const exportProductsReportSuccess = createAction('[Products Analytics] Export Report Success');
export const exportProductsReportFailure = createAction(
  '[Products Analytics] Export Report Failure',
  props<{ error: string }>(),
);

// Clear
export const clearProductsAnalyticsState = createAction('[Products Analytics] Clear State');

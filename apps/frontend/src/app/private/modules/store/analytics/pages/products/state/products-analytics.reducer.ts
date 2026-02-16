import { createReducer, on } from '@ngrx/store';
import { ProductsAnalyticsState, initialProductsAnalyticsState } from './products-analytics.state';
import * as ProductsActions from './products-analytics.actions';

export const productsAnalyticsReducer = createReducer(
  initialProductsAnalyticsState,

  // Filters
  on(ProductsActions.setDateRange, (state, { dateRange }) => ({
    ...state,
    dateRange,
  })),
  on(ProductsActions.setSearch, (state, { search }) => ({
    ...state,
    search,
    page: 1,
  })),
  on(ProductsActions.setPage, (state, { page }) => ({
    ...state,
    page,
  })),
  on(ProductsActions.setSort, (state, { sortBy, sortOrder }) => ({
    ...state,
    sortBy,
    sortOrder,
    page: 1,
  })),

  // Load Summary
  on(ProductsActions.loadProductsSummary, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(ProductsActions.loadProductsSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    loading: false,
    error: null,
  })),
  on(ProductsActions.loadProductsSummaryFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // Load Top Sellers
  on(ProductsActions.loadTopSellers, (state) => ({
    ...state,
    loadingTopSellers: true,
    error: null,
  })),
  on(ProductsActions.loadTopSellersSuccess, (state, { topSellers }) => ({
    ...state,
    topSellers,
    loadingTopSellers: false,
    error: null,
  })),
  on(ProductsActions.loadTopSellersFailure, (state, { error }) => ({
    ...state,
    loadingTopSellers: false,
    error,
  })),

  // Load Products Table
  on(ProductsActions.loadProductsTable, (state) => ({
    ...state,
    loadingTable: true,
    error: null,
  })),
  on(ProductsActions.loadProductsTableSuccess, (state, { products, total }) => ({
    ...state,
    products,
    totalProducts: total,
    loadingTable: false,
    error: null,
  })),
  on(ProductsActions.loadProductsTableFailure, (state, { error }) => ({
    ...state,
    loadingTable: false,
    error,
  })),

  // Export
  on(ProductsActions.exportProductsReport, (state) => ({
    ...state,
    exporting: true,
  })),
  on(ProductsActions.exportProductsReportSuccess, (state) => ({
    ...state,
    exporting: false,
  })),
  on(ProductsActions.exportProductsReportFailure, (state, { error }) => ({
    ...state,
    exporting: false,
    error,
  })),

  // Clear
  on(ProductsActions.clearProductsAnalyticsState, () => initialProductsAnalyticsState),
);

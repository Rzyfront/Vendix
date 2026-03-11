import { createFeatureSelector, createSelector } from '@ngrx/store';
import { InvoicingState } from '../invoicing.state';

export const selectInvoicingState =
  createFeatureSelector<InvoicingState>('invoicing');

// Invoices
export const selectInvoices = createSelector(
  selectInvoicingState,
  (state) => state.invoices,
);

export const selectInvoicesLoading = createSelector(
  selectInvoicingState,
  (state) => state.loading,
);

export const selectInvoicesError = createSelector(
  selectInvoicingState,
  (state) => state.error,
);

export const selectInvoicesMeta = createSelector(
  selectInvoicingState,
  (state) => state.meta,
);

// Current Invoice
export const selectCurrentInvoice = createSelector(
  selectInvoicingState,
  (state) => state.currentInvoice,
);

export const selectCurrentInvoiceLoading = createSelector(
  selectInvoicingState,
  (state) => state.currentInvoiceLoading,
);

// Stats (from backend, NOT derived client-side)
export const selectStats = createSelector(
  selectInvoicingState,
  (state) => state.stats,
);

export const selectLoadingStats = createSelector(
  selectInvoicingState,
  (state) => state.loadingStats,
);

// Filter selectors
export const selectSearch = createSelector(
  selectInvoicingState,
  (state) => state.search,
);

export const selectPage = createSelector(
  selectInvoicingState,
  (state) => state.page,
);

export const selectLimit = createSelector(
  selectInvoicingState,
  (state) => state.limit,
);

export const selectSortBy = createSelector(
  selectInvoicingState,
  (state) => state.sortBy,
);

export const selectSortOrder = createSelector(
  selectInvoicingState,
  (state) => state.sortOrder,
);

export const selectStatusFilter = createSelector(
  selectInvoicingState,
  (state) => state.statusFilter,
);

export const selectTypeFilter = createSelector(
  selectInvoicingState,
  (state) => state.typeFilter,
);

export const selectDateFrom = createSelector(
  selectInvoicingState,
  (state) => state.dateFrom,
);

export const selectDateTo = createSelector(
  selectInvoicingState,
  (state) => state.dateTo,
);

// Resolutions
export const selectResolutions = createSelector(
  selectInvoicingState,
  (state) => state.resolutions,
);

export const selectResolutionsLoading = createSelector(
  selectInvoicingState,
  (state) => state.resolutionsLoading,
);

export const selectActiveResolutions = createSelector(
  selectResolutions,
  (resolutions) => resolutions.filter((r) => r.is_active),
);

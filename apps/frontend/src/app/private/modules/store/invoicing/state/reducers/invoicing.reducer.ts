import { createReducer, on } from '@ngrx/store';
import { InvoicingState, initialInvoicingState } from '../invoicing.state';
import * as InvoicingActions from '../actions/invoicing.actions';

export const invoicingReducer = createReducer(
  initialInvoicingState,

  // ── Load Invoices ───────────────────────────────────────
  on(InvoicingActions.loadInvoices, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.loadInvoicesSuccess, (state, { invoices, meta }) => ({
    ...state,
    invoices,
    meta,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.loadInvoicesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Load Single Invoice ─────────────────────────────────
  on(InvoicingActions.loadInvoice, (state) => ({
    ...state,
    currentInvoiceLoading: true,
    error: null,
  })),
  on(InvoicingActions.loadInvoiceSuccess, (state, { invoice }) => ({
    ...state,
    currentInvoice: invoice,
    currentInvoiceLoading: false,
    error: null,
  })),
  on(InvoicingActions.loadInvoiceFailure, (state, { error }) => ({
    ...state,
    currentInvoiceLoading: false,
    error,
  })),

  // ── Create Invoice ──────────────────────────────────────
  on(InvoicingActions.createInvoice, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.createInvoiceSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.createInvoiceFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Create From Order ───────────────────────────────────
  on(InvoicingActions.createFromOrder, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.createFromOrderSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.createFromOrderFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Create From Sales Order ─────────────────────────────
  on(InvoicingActions.createFromSalesOrder, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.createFromSalesOrderSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.createFromSalesOrderFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Update Invoice ──────────────────────────────────────
  on(InvoicingActions.updateInvoice, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.updateInvoiceSuccess, (state, { invoice }) => ({
    ...state,
    currentInvoice: invoice,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.updateInvoiceFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Delete Invoice ──────────────────────────────────────
  on(InvoicingActions.deleteInvoice, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.deleteInvoiceSuccess, (state, { id }) => ({
    ...state,
    currentInvoice:
      state.currentInvoice?.id === id ? null : state.currentInvoice,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.deleteInvoiceFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Validate / Send ─────────────────────────────────────
  on(
    InvoicingActions.validateInvoice,
    InvoicingActions.sendInvoice,
    (state) => ({
      ...state,
      loading: true,
      error: null,
    }),
  ),
  on(
    InvoicingActions.validateInvoiceSuccess,
    InvoicingActions.sendInvoiceSuccess,
    (state, { invoice }) => ({
      ...state,
      currentInvoice: invoice,
      loading: false,
      error: null,
    }),
  ),
  on(
    InvoicingActions.validateInvoiceFailure,
    InvoicingActions.sendInvoiceFailure,
    (state, { error }) => ({
      ...state,
      loading: false,
      error,
    }),
  ),

  // ── Accept / Reject / Cancel / Void ───────────────────────
  on(
    InvoicingActions.acceptInvoice,
    InvoicingActions.rejectInvoice,
    InvoicingActions.cancelInvoice,
    InvoicingActions.voidInvoice,
    (state) => ({
      ...state,
      loading: true,
      error: null,
    }),
  ),
  on(
    InvoicingActions.acceptInvoiceSuccess,
    InvoicingActions.rejectInvoiceSuccess,
    InvoicingActions.cancelInvoiceSuccess,
    InvoicingActions.voidInvoiceSuccess,
    (state, { invoice }) => ({
      ...state,
      currentInvoice: invoice,
      loading: false,
      error: null,
    }),
  ),
  on(
    InvoicingActions.acceptInvoiceFailure,
    InvoicingActions.rejectInvoiceFailure,
    InvoicingActions.cancelInvoiceFailure,
    InvoicingActions.voidInvoiceFailure,
    (state, { error }) => ({
      ...state,
      loading: false,
      error,
    }),
  ),

  // ── Credit / Debit Notes ────────────────────────────────
  on(
    InvoicingActions.createCreditNote,
    InvoicingActions.createDebitNote,
    (state) => ({
      ...state,
      loading: true,
      error: null,
    }),
  ),
  on(
    InvoicingActions.createCreditNoteSuccess,
    InvoicingActions.createDebitNoteSuccess,
    (state) => ({
      ...state,
      loading: false,
      error: null,
    }),
  ),
  on(
    InvoicingActions.createCreditNoteFailure,
    InvoicingActions.createDebitNoteFailure,
    (state, { error }) => ({
      ...state,
      loading: false,
      error,
    }),
  ),

  // ── Stats ───────────────────────────────────────────────
  on(InvoicingActions.loadInvoiceStats, (state) => ({
    ...state,
    loadingStats: true,
  })),
  on(InvoicingActions.loadInvoiceStatsSuccess, (state, { stats }) => ({
    ...state,
    stats,
    loadingStats: false,
  })),
  on(InvoicingActions.loadInvoiceStatsFailure, (state) => ({
    ...state,
    loadingStats: false,
  })),

  // ── Resolutions ─────────────────────────────────────────
  on(InvoicingActions.loadResolutions, (state) => ({
    ...state,
    resolutionsLoading: true,
    error: null,
  })),
  on(InvoicingActions.loadResolutionsSuccess, (state, { resolutions }) => ({
    ...state,
    resolutions,
    resolutionsLoading: false,
    error: null,
  })),
  on(InvoicingActions.loadResolutionsFailure, (state, { error }) => ({
    ...state,
    resolutionsLoading: false,
    error,
  })),

  on(InvoicingActions.createResolutionSuccess, (state, { resolution }) => ({
    ...state,
    resolutions: [...state.resolutions, resolution],
  })),

  on(InvoicingActions.updateResolutionSuccess, (state, { resolution }) => ({
    ...state,
    resolutions: state.resolutions.map((r) =>
      r.id === resolution.id ? resolution : r,
    ),
  })),

  on(InvoicingActions.deleteResolutionSuccess, (state, { id }) => ({
    ...state,
    resolutions: state.resolutions.filter((r) => r.id !== id),
  })),

  // ── DIAN Configs ────────────────────────────────────────
  on(InvoicingActions.loadDianConfigs, (state) => ({
    ...state,
    dianConfigsLoading: true,
    dianConfigsError: null,
  })),
  on(InvoicingActions.loadDianConfigsSuccess, (state, { configs }) => ({
    ...state,
    dianConfigs: configs,
    dianConfigsLoading: false,
    dianConfigsError: null,
  })),
  on(InvoicingActions.loadDianConfigsFailure, (state, { error }) => ({
    ...state,
    dianConfigsLoading: false,
    dianConfigsError: error,
  })),

  // ── Filter setters ─────────────────────────────────────
  on(InvoicingActions.setSearch, (state, { search }) => ({
    ...state,
    search,
    page: 1,
  })),
  on(InvoicingActions.setPage, (state, { page }) => ({
    ...state,
    page,
  })),
  on(InvoicingActions.setSort, (state, { sortBy, sortOrder }) => ({
    ...state,
    sortBy,
    sortOrder,
    page: 1,
  })),
  on(InvoicingActions.setStatusFilter, (state, { statusFilter }) => ({
    ...state,
    statusFilter,
    page: 1,
  })),
  on(InvoicingActions.setTypeFilter, (state, { typeFilter }) => ({
    ...state,
    typeFilter,
    page: 1,
  })),
  on(InvoicingActions.setDateRange, (state, { dateFrom, dateTo }) => ({
    ...state,
    dateFrom,
    dateTo,
    page: 1,
  })),
  on(InvoicingActions.clearFilters, (state) => ({
    ...state,
    search: '',
    page: 1,
    statusFilter: '',
    typeFilter: '',
    dateFrom: '',
    dateTo: '',
  })),

  // ── Clear State ─────────────────────────────────────────
  on(InvoicingActions.clearInvoicingState, () => initialInvoicingState),
);

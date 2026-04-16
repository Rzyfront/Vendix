import { createReducer, on } from '@ngrx/store';
import { ReportsActions } from './reports.actions';
import { initialReportsState } from './reports.state';

export const reportsReducer = createReducer(
  initialReportsState,

  on(ReportsActions.setCategory, (state, { category }) => ({
    ...state,
    selectedCategory: category,
  })),

  on(ReportsActions.selectReport, (state, { reportId }) => ({
    ...state,
    selectedReportId: reportId,
    reportData: null,
    reportMeta: null,
    error: null,
  })),

  on(ReportsActions.clearReport, (state) => ({
    ...state,
    selectedReportId: null,
    reportData: null,
    reportMeta: null,
    error: null,
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
  })),

  on(ReportsActions.setDateRange, (state, { dateRange }) => ({
    ...state,
    dateRange,
  })),

  on(ReportsActions.setFiscalPeriod, (state, { fiscalPeriodId }) => ({
    ...state,
    fiscalPeriodId,
  })),

  on(ReportsActions.loadReportData, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(ReportsActions.loadReportDataSuccess, (state, { data, meta, isSummary, summaryData }) => ({
    ...state,
    reportData: data,
    reportMeta: meta || null,
    isSummary: isSummary ?? false,
    summaryData: summaryData ?? null,
    loading: false,
    currentPage: meta?.['page'] ?? meta?.['pagination']?.page ?? state.currentPage,
    totalPages: meta?.['totalPages'] ?? meta?.['pagination']?.total_pages ?? state.totalPages,
    totalItems: meta?.['total'] ?? meta?.['pagination']?.total ?? state.totalItems,
  })),

  on(ReportsActions.loadReportDataFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(ReportsActions.setPage, (state, { page }) => ({
    ...state,
    currentPage: page,
  })),

  on(ReportsActions.setItemsPerPage, (state, { itemsPerPage }) => ({
    ...state,
    itemsPerPage,
    currentPage: 1,
  })),

  on(ReportsActions.exportReport, (state) => ({
    ...state,
    exporting: true,
  })),

  on(ReportsActions.exportReportSuccess, (state) => ({
    ...state,
    exporting: false,
  })),

  on(ReportsActions.exportReportFailure, (state, { error }) => ({
    ...state,
    exporting: false,
    error,
  })),
);

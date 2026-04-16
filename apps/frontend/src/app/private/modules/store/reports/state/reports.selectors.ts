import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ReportsState } from './reports.state';
import { getReportById } from '../config/report-registry';

export const selectReportsState = createFeatureSelector<ReportsState>('reports');

export const selectSelectedCategory = createSelector(
  selectReportsState,
  (state) => state.selectedCategory,
);

export const selectSelectedReportId = createSelector(
  selectReportsState,
  (state) => state.selectedReportId,
);

export const selectSelectedReport = createSelector(
  selectSelectedReportId,
  (reportId) => (reportId ? getReportById(reportId) : null),
);

export const selectDateRange = createSelector(
  selectReportsState,
  (state) => state.dateRange,
);

export const selectFiscalPeriodId = createSelector(
  selectReportsState,
  (state) => state.fiscalPeriodId,
);

export const selectReportData = createSelector(
  selectReportsState,
  (state) => state.reportData,
);

export const selectReportMeta = createSelector(
  selectReportsState,
  (state) => state.reportMeta,
);

export const selectLoading = createSelector(
  selectReportsState,
  (state) => state.loading,
);

export const selectExporting = createSelector(
  selectReportsState,
  (state) => state.exporting,
);

export const selectError = createSelector(
  selectReportsState,
  (state) => state.error,
);

export const selectIsSummary = createSelector(
  selectReportsState,
  (state) => state.isSummary,
);

export const selectSummaryData = createSelector(
  selectReportsState,
  (state) => state.summaryData,
);

export const selectCurrentPage = createSelector(
  selectReportsState,
  (state) => state.currentPage,
);

export const selectTotalPages = createSelector(
  selectReportsState,
  (state) => state.totalPages,
);

export const selectTotalItems = createSelector(
  selectReportsState,
  (state) => state.totalItems,
);

export const selectItemsPerPage = createSelector(
  selectReportsState,
  (state) => state.itemsPerPage,
);

export const selectPagination = createSelector(
  selectCurrentPage,
  selectTotalPages,
  selectTotalItems,
  selectItemsPerPage,
  (currentPage, totalPages, totalItems, itemsPerPage) => ({
    currentPage,
    totalPages,
    totalItems,
    itemsPerPage,
  }),
);

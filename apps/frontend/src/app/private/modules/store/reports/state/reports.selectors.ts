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

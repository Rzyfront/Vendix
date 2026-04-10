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

  on(ReportsActions.loadReportDataSuccess, (state, { data, meta }) => ({
    ...state,
    reportData: data,
    reportMeta: meta || null,
    loading: false,
  })),

  on(ReportsActions.loadReportDataFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
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

import { createFeatureSelector, createSelector } from '@ngrx/store';
import { PayrollState } from '../payroll.state';

export const selectPayrollState =
  createFeatureSelector<PayrollState>('payroll');

// ─── Employees ────────────────────────────────────────────
export const selectEmployees = createSelector(
  selectPayrollState,
  (state) => state.employees,
);

export const selectEmployeesLoading = createSelector(
  selectPayrollState,
  (state) => state.employeesLoading,
);

export const selectEmployeeMeta = createSelector(
  selectPayrollState,
  (state) => state.employeeMeta,
);

export const selectCurrentEmployee = createSelector(
  selectPayrollState,
  (state) => state.currentEmployee,
);

export const selectCurrentEmployeeLoading = createSelector(
  selectPayrollState,
  (state) => state.currentEmployeeLoading,
);

export const selectEmployeeStats = createSelector(
  selectPayrollState,
  (state) => state.employeeStats,
);

export const selectEmployeeStatsLoading = createSelector(
  selectPayrollState,
  (state) => state.employeeStatsLoading,
);

// ─── Employee Filters ─────────────────────────────────────
export const selectEmployeeSearch = createSelector(
  selectPayrollState,
  (state) => state.employeeSearch,
);

export const selectEmployeePage = createSelector(
  selectPayrollState,
  (state) => state.employeePage,
);

export const selectEmployeeStatusFilter = createSelector(
  selectPayrollState,
  (state) => state.employeeStatusFilter,
);

export const selectEmployeeDepartmentFilter = createSelector(
  selectPayrollState,
  (state) => state.employeeDepartmentFilter,
);

// ─── Payroll Runs ─────────────────────────────────────────
export const selectPayrollRuns = createSelector(
  selectPayrollState,
  (state) => state.payrollRuns,
);

export const selectPayrollRunsLoading = createSelector(
  selectPayrollState,
  (state) => state.payrollRunsLoading,
);

export const selectPayrollRunMeta = createSelector(
  selectPayrollState,
  (state) => state.payrollRunMeta,
);

export const selectCurrentPayrollRun = createSelector(
  selectPayrollState,
  (state) => state.currentPayrollRun,
);

export const selectCurrentPayrollRunLoading = createSelector(
  selectPayrollState,
  (state) => state.currentPayrollRunLoading,
);

export const selectPayrollRunStats = createSelector(
  selectPayrollState,
  (state) => state.payrollRunStats,
);

export const selectPayrollRunStatsLoading = createSelector(
  selectPayrollState,
  (state) => state.payrollRunStatsLoading,
);

// ─── Payroll Run Filters ──────────────────────────────────
export const selectPayrollRunSearch = createSelector(
  selectPayrollState,
  (state) => state.payrollRunSearch,
);

export const selectPayrollRunPage = createSelector(
  selectPayrollState,
  (state) => state.payrollRunPage,
);

export const selectPayrollRunStatusFilter = createSelector(
  selectPayrollState,
  (state) => state.payrollRunStatusFilter,
);

export const selectPayrollRunFrequencyFilter = createSelector(
  selectPayrollState,
  (state) => state.payrollRunFrequencyFilter,
);

export const selectPayrollRunDateFrom = createSelector(
  selectPayrollState,
  (state) => state.payrollRunDateFrom,
);

export const selectPayrollRunDateTo = createSelector(
  selectPayrollState,
  (state) => state.payrollRunDateTo,
);

// ─── Shared ───────────────────────────────────────────────
export const selectPayrollError = createSelector(
  selectPayrollState,
  (state) => state.error,
);

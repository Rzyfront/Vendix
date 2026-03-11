import { createReducer, on } from '@ngrx/store';
import { PayrollState, initialPayrollState } from '../payroll.state';
import * as PayrollActions from '../actions/payroll.actions';

export const payrollReducer = createReducer(
  initialPayrollState,

  // ─── Load Employees ─────────────────────────────────────
  on(PayrollActions.loadEmployees, (state) => ({
    ...state,
    employeesLoading: true,
    error: null,
  })),
  on(PayrollActions.loadEmployeesSuccess, (state, { employees, meta }) => ({
    ...state,
    employees,
    employeeMeta: meta,
    employeesLoading: false,
    error: null,
  })),
  on(PayrollActions.loadEmployeesFailure, (state, { error }) => ({
    ...state,
    employeesLoading: false,
    error,
  })),

  // ─── Load Single Employee ───────────────────────────────
  on(PayrollActions.loadEmployee, (state) => ({
    ...state,
    currentEmployeeLoading: true,
    error: null,
  })),
  on(PayrollActions.loadEmployeeSuccess, (state, { employee }) => ({
    ...state,
    currentEmployee: employee,
    currentEmployeeLoading: false,
    error: null,
  })),
  on(PayrollActions.loadEmployeeFailure, (state, { error }) => ({
    ...state,
    currentEmployeeLoading: false,
    error,
  })),

  // ─── Create Employee ───────────────────────────────────
  on(PayrollActions.createEmployee, (state) => ({
    ...state,
    employeesLoading: true,
    error: null,
  })),
  on(PayrollActions.createEmployeeSuccess, (state) => ({
    ...state,
    employeesLoading: false,
    error: null,
  })),
  on(PayrollActions.createEmployeeFailure, (state, { error }) => ({
    ...state,
    employeesLoading: false,
    error,
  })),

  // ─── Update Employee ───────────────────────────────────
  on(PayrollActions.updateEmployee, (state) => ({
    ...state,
    employeesLoading: true,
    error: null,
  })),
  on(PayrollActions.updateEmployeeSuccess, (state, { employee }) => ({
    ...state,
    currentEmployee: employee,
    employeesLoading: false,
    error: null,
  })),
  on(PayrollActions.updateEmployeeFailure, (state, { error }) => ({
    ...state,
    employeesLoading: false,
    error,
  })),

  // ─── Terminate Employee ─────────────────────────────────
  on(PayrollActions.terminateEmployee, (state) => ({
    ...state,
    employeesLoading: true,
    error: null,
  })),
  on(PayrollActions.terminateEmployeeSuccess, (state, { employee }) => ({
    ...state,
    currentEmployee: employee,
    employeesLoading: false,
    error: null,
  })),
  on(PayrollActions.terminateEmployeeFailure, (state, { error }) => ({
    ...state,
    employeesLoading: false,
    error,
  })),

  // ─── Employee Stats ─────────────────────────────────────
  on(PayrollActions.loadEmployeeStats, (state) => ({
    ...state,
    employeeStatsLoading: true,
  })),
  on(PayrollActions.loadEmployeeStatsSuccess, (state, { stats }) => ({
    ...state,
    employeeStats: stats,
    employeeStatsLoading: false,
  })),
  on(PayrollActions.loadEmployeeStatsFailure, (state) => ({
    ...state,
    employeeStatsLoading: false,
  })),

  // ─── Employee Filters ───────────────────────────────────
  on(PayrollActions.setEmployeeSearch, (state, { search }) => ({
    ...state,
    employeeSearch: search,
    employeePage: 1,
  })),
  on(PayrollActions.setEmployeePage, (state, { page }) => ({
    ...state,
    employeePage: page,
  })),
  on(PayrollActions.setEmployeeSort, (state, { sortBy, sortOrder }) => ({
    ...state,
    employeeSortBy: sortBy,
    employeeSortOrder: sortOrder,
    employeePage: 1,
  })),
  on(PayrollActions.setEmployeeStatusFilter, (state, { statusFilter }) => ({
    ...state,
    employeeStatusFilter: statusFilter,
    employeePage: 1,
  })),
  on(PayrollActions.setEmployeeDepartmentFilter, (state, { departmentFilter }) => ({
    ...state,
    employeeDepartmentFilter: departmentFilter,
    employeePage: 1,
  })),
  on(PayrollActions.clearEmployeeFilters, (state) => ({
    ...state,
    employeeSearch: '',
    employeePage: 1,
    employeeStatusFilter: '',
    employeeDepartmentFilter: '',
  })),

  // ─── Load Payroll Runs ──────────────────────────────────
  on(PayrollActions.loadPayrollRuns, (state) => ({
    ...state,
    payrollRunsLoading: true,
    error: null,
  })),
  on(PayrollActions.loadPayrollRunsSuccess, (state, { payrollRuns, meta }) => ({
    ...state,
    payrollRuns,
    payrollRunMeta: meta,
    payrollRunsLoading: false,
    error: null,
  })),
  on(PayrollActions.loadPayrollRunsFailure, (state, { error }) => ({
    ...state,
    payrollRunsLoading: false,
    error,
  })),

  // ─── Load Single Payroll Run ────────────────────────────
  on(PayrollActions.loadPayrollRun, (state) => ({
    ...state,
    currentPayrollRunLoading: true,
    error: null,
  })),
  on(PayrollActions.loadPayrollRunSuccess, (state, { payrollRun }) => ({
    ...state,
    currentPayrollRun: payrollRun,
    currentPayrollRunLoading: false,
    error: null,
  })),
  on(PayrollActions.loadPayrollRunFailure, (state, { error }) => ({
    ...state,
    currentPayrollRunLoading: false,
    error,
  })),

  // ─── Create Payroll Run ─────────────────────────────────
  on(PayrollActions.createPayrollRun, (state) => ({
    ...state,
    payrollRunsLoading: true,
    error: null,
  })),
  on(PayrollActions.createPayrollRunSuccess, (state) => ({
    ...state,
    payrollRunsLoading: false,
    error: null,
  })),
  on(PayrollActions.createPayrollRunFailure, (state, { error }) => ({
    ...state,
    payrollRunsLoading: false,
    error,
  })),

  // ─── Payroll Run State Transitions ──────────────────────
  on(
    PayrollActions.calculatePayrollRun,
    PayrollActions.approvePayrollRun,
    PayrollActions.sendPayrollRun,
    PayrollActions.payPayrollRun,
    PayrollActions.cancelPayrollRun,
    (state) => ({
      ...state,
      payrollRunsLoading: true,
      error: null,
    }),
  ),
  on(
    PayrollActions.calculatePayrollRunSuccess,
    PayrollActions.approvePayrollRunSuccess,
    PayrollActions.sendPayrollRunSuccess,
    PayrollActions.payPayrollRunSuccess,
    PayrollActions.cancelPayrollRunSuccess,
    (state, { payrollRun }) => ({
      ...state,
      currentPayrollRun: payrollRun,
      payrollRunsLoading: false,
      error: null,
    }),
  ),
  on(
    PayrollActions.calculatePayrollRunFailure,
    PayrollActions.approvePayrollRunFailure,
    PayrollActions.sendPayrollRunFailure,
    PayrollActions.payPayrollRunFailure,
    PayrollActions.cancelPayrollRunFailure,
    (state, { error }) => ({
      ...state,
      payrollRunsLoading: false,
      error,
    }),
  ),

  // ─── Payroll Run Stats ──────────────────────────────────
  on(PayrollActions.loadPayrollRunStats, (state) => ({
    ...state,
    payrollRunStatsLoading: true,
  })),
  on(PayrollActions.loadPayrollRunStatsSuccess, (state, { stats }) => ({
    ...state,
    payrollRunStats: stats,
    payrollRunStatsLoading: false,
  })),
  on(PayrollActions.loadPayrollRunStatsFailure, (state) => ({
    ...state,
    payrollRunStatsLoading: false,
  })),

  // ─── Payroll Run Filters ────────────────────────────────
  on(PayrollActions.setPayrollRunSearch, (state, { search }) => ({
    ...state,
    payrollRunSearch: search,
    payrollRunPage: 1,
  })),
  on(PayrollActions.setPayrollRunPage, (state, { page }) => ({
    ...state,
    payrollRunPage: page,
  })),
  on(PayrollActions.setPayrollRunSort, (state, { sortBy, sortOrder }) => ({
    ...state,
    payrollRunSortBy: sortBy,
    payrollRunSortOrder: sortOrder,
    payrollRunPage: 1,
  })),
  on(PayrollActions.setPayrollRunStatusFilter, (state, { statusFilter }) => ({
    ...state,
    payrollRunStatusFilter: statusFilter,
    payrollRunPage: 1,
  })),
  on(PayrollActions.setPayrollRunFrequencyFilter, (state, { frequencyFilter }) => ({
    ...state,
    payrollRunFrequencyFilter: frequencyFilter,
    payrollRunPage: 1,
  })),
  on(PayrollActions.setPayrollRunDateRange, (state, { dateFrom, dateTo }) => ({
    ...state,
    payrollRunDateFrom: dateFrom,
    payrollRunDateTo: dateTo,
    payrollRunPage: 1,
  })),
  on(PayrollActions.clearPayrollRunFilters, (state) => ({
    ...state,
    payrollRunSearch: '',
    payrollRunPage: 1,
    payrollRunStatusFilter: '',
    payrollRunFrequencyFilter: '',
    payrollRunDateFrom: '',
    payrollRunDateTo: '',
  })),

  // ─── Clear State ────────────────────────────────────────
  on(PayrollActions.clearPayrollState, () => initialPayrollState),
);

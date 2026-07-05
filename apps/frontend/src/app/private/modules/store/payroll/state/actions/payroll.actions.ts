import { createAction, props } from '@ngrx/store';
import {
  Employee,
  PayrollRun,
  CreateEmployeeDto,
  UpdateEmployeeDto,
  CreatePayrollRunDto,
  EmployeeStats,
  PayrollStats,
  ExistingEmployeePayload,
  DianSendResult,
  DianStatusView,
  DianAdjustmentPayload,
  DianAdjustmentResult,
  BankOption,
  BankDataValidationResult,
  BankExportResult,
  ExportAchDto,
} from '../../interfaces/payroll.interface';

// ─── Load Employees ───────────────────────────────────────
export const loadEmployees = createAction('[Payroll] Load Employees');
export const loadEmployeesSuccess = createAction(
  '[Payroll] Load Employees Success',
  props<{ employees: Employee[]; meta: any }>(),
);
export const loadEmployeesFailure = createAction(
  '[Payroll] Load Employees Failure',
  props<{ error: string }>(),
);

// ─── Load Single Employee ─────────────────────────────────
export const loadEmployee = createAction(
  '[Payroll] Load Employee',
  props<{ id: number }>(),
);
export const loadEmployeeSuccess = createAction(
  '[Payroll] Load Employee Success',
  props<{ employee: Employee }>(),
);
export const loadEmployeeFailure = createAction(
  '[Payroll] Load Employee Failure',
  props<{ error: string }>(),
);

// ─── Create Employee ──────────────────────────────────────
export const createEmployee = createAction(
  '[Payroll] Create Employee',
  props<{ employee: CreateEmployeeDto }>(),
);
export const createEmployeeSuccess = createAction(
  '[Payroll] Create Employee Success',
  props<{ employee: Employee }>(),
);
export const createEmployeeFailure = createAction(
  '[Payroll] Create Employee Failure',
  props<{
    error: string;
    errorCode?: string;
    existingEmployee?: ExistingEmployeePayload;
    pendingDto?: CreateEmployeeDto;
  }>(),
);

// ─── Update Employee ──────────────────────────────────────
export const updateEmployee = createAction(
  '[Payroll] Update Employee',
  props<{ id: number; employee: UpdateEmployeeDto }>(),
);
export const updateEmployeeSuccess = createAction(
  '[Payroll] Update Employee Success',
  props<{ employee: Employee }>(),
);
export const updateEmployeeFailure = createAction(
  '[Payroll] Update Employee Failure',
  props<{ error: string }>(),
);

// ─── Terminate Employee ───────────────────────────────────
export const terminateEmployee = createAction(
  '[Payroll] Terminate Employee',
  props<{ id: number }>(),
);
export const terminateEmployeeSuccess = createAction(
  '[Payroll] Terminate Employee Success',
  props<{ employee: Employee }>(),
);
export const terminateEmployeeFailure = createAction(
  '[Payroll] Terminate Employee Failure',
  props<{ error: string }>(),
);

// ─── Employee Stats ───────────────────────────────────────
export const loadEmployeeStats = createAction('[Payroll] Load Employee Stats');
export const loadEmployeeStatsSuccess = createAction(
  '[Payroll] Load Employee Stats Success',
  props<{ stats: EmployeeStats }>(),
);
export const loadEmployeeStatsFailure = createAction(
  '[Payroll] Load Employee Stats Failure',
  props<{ error: string }>(),
);

// ─── Employee Filters ─────────────────────────────────────
export const setEmployeeSearch = createAction(
  '[Payroll] Set Employee Search',
  props<{ search: string }>(),
);
export const setEmployeePage = createAction(
  '[Payroll] Set Employee Page',
  props<{ page: number }>(),
);
export const setEmployeeSort = createAction(
  '[Payroll] Set Employee Sort',
  props<{ sortBy: string; sortOrder: 'asc' | 'desc' }>(),
);
export const setEmployeeStatusFilter = createAction(
  '[Payroll] Set Employee Status Filter',
  props<{ statusFilter: string }>(),
);
export const setEmployeeDepartmentFilter = createAction(
  '[Payroll] Set Employee Department Filter',
  props<{ departmentFilter: string }>(),
);
export const clearEmployeeFilters = createAction('[Payroll] Clear Employee Filters');

// ─── Load Payroll Runs ────────────────────────────────────
export const loadPayrollRuns = createAction('[Payroll] Load Payroll Runs');
export const loadPayrollRunsSuccess = createAction(
  '[Payroll] Load Payroll Runs Success',
  props<{ payrollRuns: PayrollRun[]; meta: any }>(),
);
export const loadPayrollRunsFailure = createAction(
  '[Payroll] Load Payroll Runs Failure',
  props<{ error: string }>(),
);

// ─── Load Single Payroll Run ──────────────────────────────
export const loadPayrollRun = createAction(
  '[Payroll] Load Payroll Run',
  props<{ id: number }>(),
);
export const loadPayrollRunSuccess = createAction(
  '[Payroll] Load Payroll Run Success',
  props<{ payrollRun: PayrollRun }>(),
);
export const loadPayrollRunFailure = createAction(
  '[Payroll] Load Payroll Run Failure',
  props<{ error: string }>(),
);

// ─── Create Payroll Run ───────────────────────────────────
export const createPayrollRun = createAction(
  '[Payroll] Create Payroll Run',
  props<{ payrollRun: CreatePayrollRunDto }>(),
);
export const createPayrollRunSuccess = createAction(
  '[Payroll] Create Payroll Run Success',
  props<{ payrollRun: PayrollRun }>(),
);
export const createPayrollRunFailure = createAction(
  '[Payroll] Create Payroll Run Failure',
  props<{ error: string }>(),
);

// ─── Payroll Run State Transitions ────────────────────────
export const calculatePayrollRun = createAction(
  '[Payroll] Calculate Payroll Run',
  props<{ id: number }>(),
);
export const calculatePayrollRunSuccess = createAction(
  '[Payroll] Calculate Payroll Run Success',
  props<{ payrollRun: PayrollRun }>(),
);
export const calculatePayrollRunFailure = createAction(
  '[Payroll] Calculate Payroll Run Failure',
  props<{ error: string }>(),
);

export const approvePayrollRun = createAction(
  '[Payroll] Approve Payroll Run',
  props<{ id: number }>(),
);
export const approvePayrollRunSuccess = createAction(
  '[Payroll] Approve Payroll Run Success',
  props<{ payrollRun: PayrollRun }>(),
);
export const approvePayrollRunFailure = createAction(
  '[Payroll] Approve Payroll Run Failure',
  props<{ error: string }>(),
);

export const sendPayrollRun = createAction(
  '[Payroll] Send Payroll Run',
  props<{ id: number }>(),
);
export const sendPayrollRunSuccess = createAction(
  '[Payroll] Send Payroll Run Success',
  props<{ payrollRun: PayrollRun }>(),
);
export const sendPayrollRunFailure = createAction(
  '[Payroll] Send Payroll Run Failure',
  props<{ error: string }>(),
);

export const payPayrollRun = createAction(
  '[Payroll] Pay Payroll Run',
  props<{ id: number }>(),
);
export const payPayrollRunSuccess = createAction(
  '[Payroll] Pay Payroll Run Success',
  props<{ payrollRun: PayrollRun }>(),
);
export const payPayrollRunFailure = createAction(
  '[Payroll] Pay Payroll Run Failure',
  props<{ error: string }>(),
);

export const cancelPayrollRun = createAction(
  '[Payroll] Cancel Payroll Run',
  props<{ id: number }>(),
);
export const cancelPayrollRunSuccess = createAction(
  '[Payroll] Cancel Payroll Run Success',
  props<{ payrollRun: PayrollRun }>(),
);
export const cancelPayrollRunFailure = createAction(
  '[Payroll] Cancel Payroll Run Failure',
  props<{ error: string }>(),
);

// ─── Payroll Run Stats ────────────────────────────────────
export const loadPayrollRunStats = createAction('[Payroll] Load Payroll Run Stats');
export const loadPayrollRunStatsSuccess = createAction(
  '[Payroll] Load Payroll Run Stats Success',
  props<{ stats: PayrollStats }>(),
);
export const loadPayrollRunStatsFailure = createAction(
  '[Payroll] Load Payroll Run Stats Failure',
  props<{ error: string }>(),
);

// ─── Payroll Run Filters ──────────────────────────────────
export const setPayrollRunSearch = createAction(
  '[Payroll] Set Payroll Run Search',
  props<{ search: string }>(),
);
export const setPayrollRunPage = createAction(
  '[Payroll] Set Payroll Run Page',
  props<{ page: number }>(),
);
export const setPayrollRunSort = createAction(
  '[Payroll] Set Payroll Run Sort',
  props<{ sortBy: string; sortOrder: 'asc' | 'desc' }>(),
);
export const setPayrollRunStatusFilter = createAction(
  '[Payroll] Set Payroll Run Status Filter',
  props<{ statusFilter: string }>(),
);
export const setPayrollRunFrequencyFilter = createAction(
  '[Payroll] Set Payroll Run Frequency Filter',
  props<{ frequencyFilter: string }>(),
);
export const setPayrollRunDateRange = createAction(
  '[Payroll] Set Payroll Run Date Range',
  props<{ dateFrom: string; dateTo: string }>(),
);
export const clearPayrollRunFilters = createAction('[Payroll] Clear Payroll Run Filters');

// ─── DIAN: Send Electronic Payroll ────────────────────────
export const sendToDian = createAction(
  '[Payroll] Send To DIAN',
  props<{ runId: number }>(),
);
export const sendToDianSuccess = createAction(
  '[Payroll] Send To DIAN Success',
  props<{ runId: number; result: DianSendResult }>(),
);
export const sendToDianFailure = createAction(
  '[Payroll] Send To DIAN Failure',
  props<{ runId: number; error: string }>(),
);

// ─── DIAN: Status Polling ─────────────────────────────────
// `loadDianStatus` starts a polling loop that fetches the DIAN status until
// a terminal state (accepted / rejected / error) is reached or the deadline
// hits. `dianStatusResult` carries each non-terminal tick; `loadDianStatusSuccess`
// carries the terminal snapshot; `stopDianStatusPolling` cancels an in-flight loop.
export const loadDianStatus = createAction(
  '[Payroll] Load DIAN Status',
  props<{ runId: number; intervalMs?: number; timeoutMs?: number }>(),
);
export const dianStatusResult = createAction(
  '[Payroll] DIAN Status Result',
  props<{ runId: number; status: DianStatusView }>(),
);
export const loadDianStatusSuccess = createAction(
  '[Payroll] Load DIAN Status Success',
  props<{ runId: number; status: DianStatusView }>(),
);
export const loadDianStatusFailure = createAction(
  '[Payroll] Load DIAN Status Failure',
  props<{ runId: number; error: string }>(),
);
export const dianStatusPollingTimeout = createAction(
  '[Payroll] DIAN Status Polling Timeout',
  props<{ runId: number }>(),
);
export const stopDianStatusPolling = createAction(
  '[Payroll] Stop DIAN Status Polling',
  props<{ runId: number }>(),
);

// ─── DIAN: Adjustment Note (tipo 103, per-item) ───────────
export const sendAdjustment = createAction(
  '[Payroll] Send Adjustment',
  props<{ runId: number; itemId: number; payload: DianAdjustmentPayload }>(),
);
export const sendAdjustmentSuccess = createAction(
  '[Payroll] Send Adjustment Success',
  props<{ runId: number; itemId: number; result: DianAdjustmentResult }>(),
);
export const sendAdjustmentFailure = createAction(
  '[Payroll] Send Adjustment Failure',
  props<{ runId: number; itemId: number; error: string }>(),
);

// ─── Bank Export: Available Banks ─────────────────────────
export const loadAvailableBanks = createAction('[Payroll] Load Available Banks');
export const loadAvailableBanksSuccess = createAction(
  '[Payroll] Load Available Banks Success',
  props<{ banks: BankOption[] }>(),
);
export const loadAvailableBanksFailure = createAction(
  '[Payroll] Load Available Banks Failure',
  props<{ error: string }>(),
);

// ─── Bank Export: Validate Employee Bank Data ─────────────
export const validateBankData = createAction(
  '[Payroll] Validate Bank Data',
  props<{ runId: number }>(),
);
export const validateBankDataSuccess = createAction(
  '[Payroll] Validate Bank Data Success',
  props<{ result: BankDataValidationResult }>(),
);
export const validateBankDataFailure = createAction(
  '[Payroll] Validate Bank Data Failure',
  props<{ error: string }>(),
);
export const clearBankValidation = createAction('[Payroll] Clear Bank Validation');

// ─── Bank Export: Generate ACH File ───────────────────────
export const exportAch = createAction(
  '[Payroll] Export ACH',
  props<{ runId: number; payload: ExportAchDto }>(),
);
export const exportAchSuccess = createAction(
  '[Payroll] Export ACH Success',
  props<{ result: BankExportResult }>(),
);
export const exportAchFailure = createAction(
  '[Payroll] Export ACH Failure',
  props<{ error: string }>(),
);

// ─── Clear State ──────────────────────────────────────────
export const clearPayrollState = createAction('[Payroll] Clear State');

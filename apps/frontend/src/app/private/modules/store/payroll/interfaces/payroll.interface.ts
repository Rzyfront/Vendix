export interface Employee {
  id: number;
  organization_id: number;
  employee_stores?: {
    id: number;
    store_id: number;
    is_primary: boolean;
    status: string;
    store: { id: number; name: string };
  }[];
  employee_code: string;
  first_name: string;
  last_name: string;
  document_type: string;
  document_number: string;
  hire_date: string;
  termination_date?: string;
  status: 'active' | 'inactive' | 'terminated';
  contract_type: 'indefinite' | 'fixed_term' | 'service' | 'apprentice';
  position?: string;
  department?: string;
  cost_center?: 'operational' | 'administrative' | 'sales';
  base_salary: number;
  payment_frequency: 'monthly' | 'biweekly' | 'weekly';
  bank_name?: string;
  bank_account_number?: string;
  health_provider?: string;
  pension_fund?: string;
  arl_risk_level?: number;
  severance_fund?: string;
  compensation_fund?: string;
  user_id?: number;
  user?: { id: number; first_name: string; last_name: string; email: string; };
  created_at: string;
  updated_at: string;
}

export interface PayrollRun {
  id: number;
  organization_id: number;
  store_id?: number;
  payroll_number: string;
  status: 'draft' | 'calculated' | 'approved' | 'sent' | 'accepted' | 'rejected' | 'paid' | 'cancelled';
  frequency: 'monthly' | 'biweekly' | 'weekly';
  period_start: string;
  period_end: string;
  payment_date?: string;
  total_earnings: number;
  total_deductions: number;
  total_employer_costs: number;
  total_net_pay: number;
  items?: PayrollItem[];
  created_at: string;
  updated_at: string;
}

export interface PayrollItem {
  id: number;
  payroll_run_id: number;
  employee_id: number;
  employee?: Employee;
  base_salary: number;
  worked_days: number;
  /**
   * Earnings JSON. Besides flat numeric keys it may carry detail arrays
   * (overtime, vacations, disabilities, licenses, bonuses) and a numeric
   * commissions key — same shapes persisted by the backend calculation.
   */
  earnings: PayrollItemEarnings;
  deductions: PayrollItemDeductions;
  employer_costs: Record<string, number>;
  provisions?: Record<string, number> | null;
  total_earnings: number;
  total_deductions: number;
  total_employer_costs: number;
  net_pay: number;
}

export interface OvertimeEarningDetail {
  type: string;
  hours: number;
  percentage: number;
  amount: number;
}

export interface VacationEarningDetail {
  start_date: string;
  end_date: string;
  quantity: number;
  payment: number;
}

export interface DisabilityEarningDetail {
  start_date: string;
  end_date: string;
  quantity: number;
  type: number;
  payment: number;
}

export interface LicenseEarningDetail {
  start_date: string;
  end_date: string;
  quantity: number;
  type: string;
  payment: number;
}

export interface BonusEarningDetail {
  taxable: number;
  non_taxable: number;
}

export interface PayrollItemEarnings {
  base_salary?: number;
  transport_subsidy?: number;
  overtime?: OvertimeEarningDetail[];
  vacations?: VacationEarningDetail[];
  disabilities?: DisabilityEarningDetail[];
  licenses?: LicenseEarningDetail[];
  bonuses?: BonusEarningDetail[];
  commissions?: number;
  total?: number;
  [key: string]: unknown;
}

/** Detalle retefuente art. 383 ET procedimiento 1 (opcional en runs históricos). */
export interface RetentionDetails {
  retention: number;
  base_depurada: number;
  base_uvt: number;
  exempt_amount: number;
  marginal_rate: number;
  uvt_value: number;
  method: 'art383_proc1';
}

export interface PayrollItemDeductions {
  health?: number;
  pension?: number;
  retention?: number;
  advance_deduction?: number;
  other_deductions?: Array<{ description: string; amount: number }>;
  retention_details?: RetentionDetails;
  total?: number;
  [key: string]: unknown;
}

// Payroll Rules (configurable per year)
export interface PayrollRules {
  health_employee_rate: number;
  pension_employee_rate: number;
  health_employer_rate: number;
  pension_employer_rate: number;
  arl_rates: Record<number, number>;
  sena_rate: number;
  icbf_rate: number;
  compensation_fund_rate: number;
  minimum_wage: number;
  transport_subsidy: number;
  transport_subsidy_threshold: number;
  retention_exempt_threshold: number;
  severance_rate: number;
  severance_interest_rate: number;
  vacation_rate: number;
  bonus_rate: number;
  days_per_month: number;
  days_per_year: number;
}

export interface PayrollRulesYearsResponse {
  years: string[];
  default_year: string;
}

// DTOs
export interface CreateEmployeeDto {
  employee_code?: string;
  first_name: string;
  last_name: string;
  document_type: string;
  document_number: string;
  hire_date: string;
  contract_type: 'indefinite' | 'fixed_term' | 'service' | 'apprentice';
  position?: string;
  department?: string;
  cost_center?: 'operational' | 'administrative' | 'sales';
  base_salary: number;
  payment_frequency: 'monthly' | 'biweekly' | 'weekly';
  bank_name?: string;
  bank_account_number?: string;
  health_provider?: string;
  pension_fund?: string;
  arl_risk_level?: number;
  severance_fund?: string;
  compensation_fund?: string;
  user_id?: number;
  associate_if_exists?: boolean;
}

export interface ExistingEmployeePayload {
  id: number;
  full_name: string;
  document_number: string;
  primary_store_name: string | null;
}

export interface AvailableUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  document_type?: string;
  document_number?: string;
}

export interface UpdateEmployeeDto extends Partial<CreateEmployeeDto> {
  status?: 'active' | 'inactive';
}

export interface QueryEmployeeDto {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  status?: string;
  department?: string;
}

export interface CreatePayrollRunDto {
  frequency: 'monthly' | 'biweekly' | 'weekly';
  period_start: string;
  period_end: string;
  payment_date?: string;
}

export interface QueryPayrollRunDto {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  status?: string;
  frequency?: string;
  date_from?: string;
  date_to?: string;
}

export interface PayrollStats {
  total_net_pay: number;
  active_employees: number;
  total_employer_cost: number;
  avg_salary: number;
}

export interface EmployeeStats {
  total: number;
  active: number;
  inactive: number;
  avg_salary: number;
  by_department: Array<{
    department: string;
    count: number;
  }>;
}

export interface PayrollListResponse {
  data: PayrollRun[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface EmployeeListResponse {
  data: Employee[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp?: string;
  path?: string;
}

// ─── Settlement Interfaces ──────────────────────────────────

export interface PayrollSettlement {
  id: number;
  organization_id: number;
  store_id: number | null;
  employee_id: number;
  settlement_number: string;
  status: 'draft' | 'calculated' | 'approved' | 'paid' | 'cancelled';
  termination_date: string;
  termination_reason: string;
  hire_date: string;
  days_worked: number;
  base_salary: number;
  contract_type: string;
  severance: number;
  severance_interest: number;
  bonus: number;
  vacation: number;
  pending_salary: number;
  indemnification: number;
  health_deduction: number;
  pension_deduction: number;
  other_deductions: number;
  total_deductions: number;
  gross_settlement: number;
  net_settlement: number;
  calculation_detail: any;
  document_url: string | null;
  notes: string | null;
  employee?: any;
  approved_by_user?: any;
  created_at: string;
}

export interface SettlementStats {
  by_status: Record<string, { count: number; total_net: number }>;
  total_gross: number;
  total_net: number;
  total_deductions: number;
  total_count: number;
}

export interface CreateSettlementDto {
  employee_id: number;
  termination_date: string;
  termination_reason: string;
  notes?: string;
  pending_salary_days?: number;
}

// ─── Advance Interfaces ─────────────────────────────────────

export interface EmployeeAdvance {
  id: number;
  organization_id: number;
  employee_id: number;
  advance_number: string;
  amount_requested: number;
  amount_approved: number;
  amount_paid: number;
  amount_pending: number;
  installments: number;
  installment_value: number;
  frequency: string;
  status: 'pending' | 'approved' | 'repaying' | 'paid' | 'rejected' | 'cancelled';
  advance_date: string;
  reason: string | null;
  notes: string | null;
  employee?: any;
  advance_payments?: AdvancePayment[];
  advance_installments?: AdvanceInstallment[];
  approved_by_user?: any;
  approved_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AdvancePayment {
  id: number;
  advance_id: number;
  payroll_item_id: number | null;
  amount: number;
  payment_date: string;
  payment_type: 'payroll_deduction' | 'manual';
  notes: string | null;
}

export interface AdvanceInstallment {
  id: number;
  advance_id: number;
  installment_number: number;
  amount: number;
  due_date: string;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  paid_at: string | null;
  payment_id: number | null;
  payroll_item_id: number | null;
}

export interface AdvanceStats {
  total_active: number;
  total_pending_approval: number;
  total_amount_pending: number;
  total_deducted_this_month: number;
}

export interface CreateAdvanceDto {
  employee_id: number;
  amount_requested: number;
  installments: number;
  frequency?: string;
  advance_date: string;
  reason?: string;
}

export interface AdvanceApproveDto {
  amount_approved?: number;
  installments?: number;
  notes?: string;
}

export interface AdvanceManualPaymentDto {
  amount: number;
  payment_date: string;
  notes?: string;
  installment_id?: number;
}

export interface EmployeeAdvanceSummary {
  total_advances: number;
  active_advances: number;
  total_requested: number;
  total_approved: number;
  total_paid: number;
  total_pending: number;
}

export interface BankExportResult {
  download_url: string;
  file_name: string;
  record_count: number;
  total_amount: number;
}

export interface PayrollUpdateAvailable {
  year: number;
  decree_ref: string | null;
  published_at: string | null;
  has_diff: boolean;
  diff: Record<string, { current: any; system: any }>;
}

// ─── Novelty Interfaces ─────────────────────────────────────

export type NoveltyType =
  | 'overtime_diurna'
  | 'overtime_nocturna'
  | 'overtime_dominical_diurna'
  | 'overtime_dominical_nocturna'
  | 'surcharge_nocturno'
  | 'surcharge_dominical'
  | 'incapacity_general'
  | 'incapacity_laboral'
  | 'vacation'
  | 'leave_paid'
  | 'leave_unpaid'
  | 'bonus'
  | 'commission'
  | 'other_deduction';

export type NoveltyStatus = 'pending' | 'applied' | 'cancelled';

export interface PayrollNovelty {
  id: number;
  organization_id?: number;
  employee_id: number;
  novelty_type: NoveltyType;
  status: NoveltyStatus;
  date_start: string;
  date_end?: string | null;
  hours?: number | null;
  days?: number | null;
  percentage?: number | null;
  amount?: number | null;
  notes?: string | null;
  payroll_run_id?: number | null;
  employee?: {
    id?: number;
    first_name: string;
    last_name: string;
    document_number?: string;
    employee_code?: string;
  };
  payroll_run?: {
    id: number;
    payroll_number: string;
    status: string;
  } | null;
  created_by_user?: { id: number; first_name: string; last_name: string } | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateNoveltyDto {
  employee_id: number;
  novelty_type: NoveltyType;
  date_start: string;
  date_end?: string;
  hours?: number;
  days?: number;
  percentage?: number;
  amount?: number;
  notes?: string;
}

export type UpdateNoveltyDto = Partial<CreateNoveltyDto>;

export interface QueryNoveltyDto {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  employee_id?: number;
  novelty_type?: NoveltyType;
  status?: NoveltyStatus;
  date_from?: string;
  date_to?: string;
}

export interface NoveltyListResponse {
  data: PayrollNovelty[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
}

// ─── PILA Interfaces ────────────────────────────────────────

export interface PilaNoveltyFlags {
  vacation: boolean;
  incapacity_general: boolean;
  incapacity_laboral: boolean;
  unpaid_leave: boolean;
}

export interface PilaEmployeeRow {
  employee_id: number;
  document_type: string;
  document_number: string;
  full_name: string;
  ibc: number;
  worked_days: number;
  arl_risk_level: number | null;
  health_employee: number;
  health_employer: number;
  pension_employee: number;
  pension_employer: number;
  arl: number;
  sena: number;
  icbf: number;
  compensation_fund: number;
  novelty_flags: PilaNoveltyFlags;
  total: number;
}

export interface PilaTotals {
  ibc?: number;
  health_employee?: number;
  health_employer?: number;
  pension_employee?: number;
  pension_employer?: number;
  arl?: number;
  sena?: number;
  icbf?: number;
  compensation_fund?: number;
  total?: number;
  [key: string]: number | undefined;
}

export interface PilaReport {
  year: number;
  month: number;
  employees: PilaEmployeeRow[];
  totals: PilaTotals;
}

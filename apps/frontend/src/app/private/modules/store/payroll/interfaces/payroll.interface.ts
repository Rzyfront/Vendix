export interface Employee {
  id: number;
  organization_id: number;
  store_id?: number;
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
  earnings: Record<string, number>;
  deductions: Record<string, number>;
  employer_costs: Record<string, number>;
  total_earnings: number;
  total_deductions: number;
  total_employer_costs: number;
  net_pay: number;
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

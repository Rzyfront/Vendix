export interface PayrollSystemDefault {
  id: number;
  year: number;
  rules: PayrollRules;
  decree_ref: string | null;
  notes: string | null;
  is_published: boolean;
  published_at: string | null;
  published_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollRules {
  minimum_wage: number;
  transport_subsidy: number;
  transport_subsidy_threshold: number;
  retention_exempt_threshold: number;
  health_employee_rate: number;
  pension_employee_rate: number;
  health_employer_rate: number;
  pension_employer_rate: number;
  arl_rates: Record<string, number>;
  sena_rate: number;
  icbf_rate: number;
  compensation_fund_rate: number;
  severance_rate: number;
  severance_interest_rate: number;
  vacation_rate: number;
  bonus_rate: number;
  days_per_month?: number;
  days_per_year?: number;
}

export interface CreatePayrollDefaultDto {
  year: number;
  decree_ref?: string | null;
  notes?: string | null;
  rules: PayrollRules;
}

export interface UpdatePayrollDefaultDto {
  decree_ref?: string | null;
  notes?: string | null;
  rules?: Partial<PayrollRules>;
}

export interface PayrollDefaultsListResponse {
  data: PayrollSystemDefault[];
}

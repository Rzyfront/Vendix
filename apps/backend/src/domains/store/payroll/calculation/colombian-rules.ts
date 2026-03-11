import { PayrollRules } from './interfaces/payroll-rules.interface';

/**
 * Colombian payroll defaults for 2026.
 * All rates are expressed as decimals (e.g., 0.04 = 4%).
 */
export const COLOMBIAN_PAYROLL_DEFAULTS_2026: PayrollRules = {
  // Employee deductions
  health_employee_rate: 0.04,
  pension_employee_rate: 0.04,

  // Employer contributions
  health_employer_rate: 0.085,
  pension_employer_rate: 0.12,
  arl_rates: {
    1: 0.00522,
    2: 0.01044,
    3: 0.02436,
    4: 0.0435,
    5: 0.0696,
  },
  sena_rate: 0.02,
  icbf_rate: 0.03,
  compensation_fund_rate: 0.04,

  // Annual values
  minimum_wage: 1423500,
  transport_subsidy: 200000,

  // Thresholds
  transport_subsidy_threshold: 2,
  retention_exempt_threshold: 4,

  // Provisions (monthly accrual)
  severance_rate: 1 / 12,
  severance_interest_rate: 0.12,
  vacation_rate: 15 / 360,
  bonus_rate: 1 / 12,

  // Calendar (Colombian payroll standard)
  days_per_month: 30,
  days_per_year: 360,
};

/**
 * Returns default PayrollRules for a given year.
 * Currently only 2026 is defined; future years can be added here.
 * Falls back to 2026 defaults for unknown years.
 */
export function getDefaultPayrollRules(year: number): PayrollRules {
  const defaults: Record<number, PayrollRules> = {
    2026: COLOMBIAN_PAYROLL_DEFAULTS_2026,
  };

  return defaults[year] || COLOMBIAN_PAYROLL_DEFAULTS_2026;
}

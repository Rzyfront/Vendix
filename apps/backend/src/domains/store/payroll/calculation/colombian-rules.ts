import {
  PayrollRules,
  OvertimeRates,
} from './interfaces/payroll-rules.interface';

/**
 * Legal monthly hours used to derive the ordinary hour value.
 * 230h as of early 2026. Ley 2101/2021 reduces the work week progressively
 * (220h from July 2026) — orgs configure it via PayrollRules.monthly_hours;
 * the reduction is intentionally NOT automated here.
 */
export const DEFAULT_MONTHLY_HOURS = 230;

/**
 * Extra rates over the ordinary hour for overtime/surcharge novelties.
 * Overtime pays hourly × hours × (1 + rate); surcharges pay hourly × hours × rate.
 */
export const DEFAULT_OVERTIME_RATES: OvertimeRates = {
  overtime_diurna: 0.25,
  overtime_nocturna: 0.75,
  overtime_dominical_diurna: 1.0,
  overtime_dominical_nocturna: 1.5,
  surcharge_nocturno: 0.35,
  surcharge_dominical: 0.8,
};

/**
 * Employer share of a general-illness incapacity day (2/3 of daily salary,
 * art. 227 CST / Decreto 2943 de 2013 for days 1-2; simplified single rate).
 */
export const DEFAULT_INCAPACITY_GENERAL_EMPLOYER_RATE = 0.6667;

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

  // Novelty valuation
  monthly_hours: DEFAULT_MONTHLY_HOURS,
  overtime_rates: DEFAULT_OVERTIME_RATES,
  incapacity_general_employer_rate: DEFAULT_INCAPACITY_GENERAL_EMPLOYER_RATE,
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

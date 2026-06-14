/**
 * Hourly rates for overtime and surcharge novelties.
 * Expressed as the EXTRA fraction over the ordinary hour value
 * (0.25 = +25%). Surcharges pay only the rate (the ordinary hour
 * is already included in the base salary).
 */
export interface OvertimeRates {
  overtime_diurna: number;
  overtime_nocturna: number;
  overtime_dominical_diurna: number;
  overtime_dominical_nocturna: number;
  surcharge_nocturno: number;
  surcharge_dominical: number;
}

/**
 * Typed interface for configurable payroll rules.
 * Stored per-year in organization_settings.settings.payroll.rules["YYYY"].
 */
export interface PayrollRules {
  // Employee deductions
  health_employee_rate: number;
  pension_employee_rate: number;

  // Employer contributions
  health_employer_rate: number;
  pension_employer_rate: number;
  arl_rates: Record<number, number>;
  sena_rate: number;
  icbf_rate: number;
  compensation_fund_rate: number;

  // Annual values
  minimum_wage: number;
  transport_subsidy: number;

  // Thresholds
  transport_subsidy_threshold: number;
  retention_exempt_threshold: number;

  // Provisions
  severance_rate: number;
  severance_interest_rate: number;
  vacation_rate: number;
  bonus_rate: number;

  // Calendar (non-editable)
  days_per_month: number;
  days_per_year: number;

  // ── Novelty valuation (optional — defaults applied when absent so
  // rules snapshots persisted before this feature keep working) ──

  /**
   * Legal monthly hours used to derive the ordinary hour value.
   * 230h in 2026; Ley 2101/2021 lowers it to 220h from July 2026
   * (configurable per organization — not automated).
   */
  monthly_hours?: number;

  /** Extra rates for overtime/surcharge novelties (0.25 = +25%). */
  overtime_rates?: OvertimeRates;

  /**
   * Employer-paid share of a general-illness incapacity day
   * (2/3 of the daily salary).
   */
  incapacity_general_employer_rate?: number;
}

/**
 * Section within OrganizationSettings for payroll configuration.
 * Keys are year strings ("2026", "2027", etc.)
 */
export interface PayrollSettingsSection {
  rules: Record<string, PayrollRules>;
}

/**
 * Represents a system default update available for an org to apply.
 */
export interface PayrollUpdateAvailable {
  year: number;
  decree_ref: string | null;
  published_at: Date | null;
  has_diff: boolean;
  diff: Record<string, { current: any; system: any }>;
}

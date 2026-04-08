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

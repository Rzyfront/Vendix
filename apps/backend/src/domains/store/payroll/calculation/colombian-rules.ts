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
 * Payment rate of a general-illness incapacity day (2/3 = 66.67% of the daily
 * salary, art. 227 CST / Decreto 2943 de 2013). The SAME rate applies to the
 * days borne by the employer (days 1-2) and to the days reimbursed by the EPS
 * (day 3+); the tramo split lives in `valuateNovelty` (see novelty-valuation.ts).
 */
export const DEFAULT_INCAPACITY_GENERAL_EMPLOYER_RATE = 0.6667;

/**
 * General-illness incapacity is borne by the EMPLOYER for the first
 * `INCAPACITY_EMPLOYER_DAYS` days; from that day on it is reimbursed by the EPS
 * (art. 1 Decreto 2943/2013).
 */
export const INCAPACITY_EMPLOYER_DAYS = 2;

/**
 * ── IBC (Ingreso Base de Cotización) bounds and factors ──
 * Applied before computing health/pension/FSP/employer contributions.
 */

/** Salario integral: only 70% of it is the base for social security (art. 18 Ley 100). */
export const INTEGRAL_IBC_FACTOR = 0.7;

/** IBC floor: 1 SMMLV. */
export const IBC_MIN_SMMLV = 1;

/** IBC ceiling: 25 SMMLV (art. 3 Decreto 510/2003). */
export const IBC_MAX_SMMLV = 25;

/**
 * Ley 1607/2012 (art. 114-1 ET) exoneration: an exonerated society does NOT
 * pay employer health (8.5%), SENA (2%) nor ICBF (3%) for employees whose
 * monthly IBC is BELOW this threshold in SMMLV. Pension (12%), ARL and the
 * compensation fund (caja, 4%) are always due.
 */
export const EXONERATION_MAX_SMMLV = 10;

/**
 * Fondo de Solidaridad Pensional (FSP): employee-side deduction on the pension
 * IBC, staggered by the IBC expressed in SMMLV. Combines the solidarity
 * subaccount (1% from 4 SMMLV) and the additional "subsistencia" subaccount
 * (extra 0.2%–1% from 16 SMMLV). Below `FSP_MIN_SMMLV` no FSP is withheld.
 * Ranges are half-open `[from, to)` in SMMLV.
 */
export const FSP_MIN_SMMLV = 4;

export interface FspTier {
  /** Inclusive lower bound in SMMLV. */
  from: number;
  /** Exclusive upper bound in SMMLV (Infinity for the top tier). */
  to: number;
  /** Combined FSP rate (solidarity + subsistence) as a decimal. */
  rate: number;
}

export const FSP_TIERS: ReadonlyArray<FspTier> = [
  { from: 4, to: 16, rate: 0.01 },
  { from: 16, to: 17, rate: 0.012 },
  { from: 17, to: 18, rate: 0.014 },
  { from: 18, to: 19, rate: 0.016 },
  { from: 19, to: 20, rate: 0.018 },
  { from: 20, to: Number.POSITIVE_INFINITY, rate: 0.02 },
];

/** Solidarity subaccount rate (the 1% base of the FSP for IBC >= 4 SMMLV). */
export const FSP_SOLIDARITY_RATE = 0.01;

/**
 * Returns the combined FSP rate (solidarity + subsistence) for a monthly IBC
 * expressed in SMMLV. Returns 0 below `FSP_MIN_SMMLV`.
 */
export function getFspRate(ibc_in_smmlv: number): number {
  if (ibc_in_smmlv < FSP_MIN_SMMLV) return 0;
  for (const tier of FSP_TIERS) {
    if (ibc_in_smmlv >= tier.from && ibc_in_smmlv < tier.to) return tier.rate;
  }
  return 0;
}

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

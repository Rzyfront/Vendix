import { PayrollRules } from './interfaces/payroll-rules.interface';
import {
  DEFAULT_MONTHLY_HOURS,
  DEFAULT_OVERTIME_RATES,
  DEFAULT_INCAPACITY_GENERAL_EMPLOYER_RATE,
  INCAPACITY_EMPLOYER_DAYS,
} from './colombian-rules';

/**
 * Pure valuation of payroll novelties (Colombian rules).
 *
 * A novelty row (payroll_novelties) is converted into a ValuatedNovelty that
 * the calculation service can fold into an employee's payroll item:
 *
 * - `earning`          → adds to total earnings (and to the IBC when salarial)
 * - `deduction`        → adds to total deductions
 * - `days_adjustment`  → reduces worked_days BEFORE proration (unpaid leave)
 */

export type ValuatedNoveltyKind = 'earning' | 'deduction' | 'days_adjustment';

/**
 * Minimal shape of a payroll_novelties row required for valuation.
 * Numeric fields are typed loosely so Prisma.Decimal, string or number
 * values can be passed without conversion by the caller.
 */
export interface PayrollNoveltyRecord {
  id: number;
  novelty_type: string;
  date_start?: Date | string | null;
  date_end?: Date | string | null;
  hours?: unknown;
  days?: unknown;
  percentage?: unknown;
  amount?: unknown;
}

export interface ValuatedNovelty {
  novelty_id: number;
  novelty_type: string;
  kind: ValuatedNoveltyKind;
  amount: number;
  hours?: number;
  days?: number;
  percentage?: number;
  date_start?: string;
  date_end?: string;
  /**
   * ── Cost-bearer split for paid absences (incapacities and licensed leaves) ──
   *
   * For a general-illness incapacity the employer pays days 1-2 and the EPS
   * reimburses day 3+; for maternity/paternity leave the EPS bears 100%; for a
   * labor incapacity the ARL bears 100%. These fields let the accounting entry
   * post `reimbursable_amount` as a receivable (cuenta por cobrar) instead of a
   * payroll cost, without re-deriving the rule.
   *
   * Invariant when present: `amount === employer_amount + reimbursable_amount`.
   * Absent for salary earnings and deductions — there the whole `amount` is an
   * employer cost.
   */
  employer_amount?: number;
  /** Portion reimbursable by a third party (EPS/ARL). A receivable, not a cost. */
  reimbursable_amount?: number;
  /** Entity that reimburses `reimbursable_amount`. */
  reimbursed_by?: 'eps' | 'arl';
}

/** Overtime/surcharge novelty types valued by the hour. */
const HOURLY_NOVELTY_TYPES = new Set([
  'overtime_diurna',
  'overtime_nocturna',
  'overtime_dominical_diurna',
  'overtime_dominical_nocturna',
  'surcharge_nocturno',
  'surcharge_dominical',
]);

/** Surcharges pay only the extra rate (the base hour is already in salary). */
const SURCHARGE_TYPES = new Set(['surcharge_nocturno', 'surcharge_dominical']);

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Values a single payroll novelty against the employee's monthly base salary.
 *
 * Formulas (Colombian rules):
 * - Hourly value      = base_salary / monthly_hours (230h default; Ley 2101
 *   reduces it over time — configurable via PayrollRules.monthly_hours).
 * - Overtime          = hourly × hours × (1 + rate)
 * - Surcharge         = hourly × hours × rate
 * - Vacation / paid leave        = (base_salary / 30) × days
 * - Incapacity (general illness) = (base_salary / 30) × days × 66.67%, split by
 *   tramo: days 1-2 borne by the EMPLOYER, day 3+ reimbursed by the EPS with a
 *   daily floor of 1 SMMLV / 30.
 * - Incapacity (labor/ARL)       = (base_salary / 30) × days (100%), reimbursed
 *   by the ARL from day 1.
 * - Maternity / paternity leave  = (base_salary / 30) × days (100%), borne by
 *   the EPS (a reimbursement, not an employer cost).
 * - Bereavement leave (luto)     = (base_salary / 30) × days, borne by the
 *   employer (5 business days by law — Ley 1280/2009).
 * - Unpaid leave      = days_adjustment (reduces worked_days, no payment)
 * - Bonus / commission / other_deduction = manual amount
 *
 * `percentage` on the novelty, when provided (> 0), overrides the applicable
 * rate (overtime/surcharge rate or incapacity employer share). It is expressed
 * as a decimal rate (0.25 = 25%).
 */
export function valuateNovelty(
  novelty: PayrollNoveltyRecord,
  base_salary: number,
  rules: PayrollRules,
): ValuatedNovelty {
  const monthly_hours = rules.monthly_hours ?? DEFAULT_MONTHLY_HOURS;
  const overtime_rates = {
    ...DEFAULT_OVERTIME_RATES,
    ...(rules.overtime_rates ?? {}),
  };
  const incapacity_general_rate =
    rules.incapacity_general_employer_rate ??
    DEFAULT_INCAPACITY_GENERAL_EMPLOYER_RATE;

  const hourly_value = base_salary / monthly_hours;
  const daily_value = base_salary / 30;

  const hours = toNumber(novelty.hours);
  const days = toNumber(novelty.days);
  const percentage_override = toNumber(novelty.percentage);
  const manual_amount = toNumber(novelty.amount);

  const base: ValuatedNovelty = {
    novelty_id: novelty.id,
    novelty_type: novelty.novelty_type,
    kind: 'earning',
    amount: 0,
    ...(hours > 0 ? { hours } : {}),
    ...(days > 0 ? { days } : {}),
    ...(percentage_override > 0 ? { percentage: percentage_override } : {}),
    date_start: toDateString(novelty.date_start),
    date_end: toDateString(novelty.date_end) ?? toDateString(novelty.date_start),
  };

  const type = novelty.novelty_type;

  if (HOURLY_NOVELTY_TYPES.has(type)) {
    const rate =
      percentage_override > 0
        ? percentage_override
        : (overtime_rates[type as keyof typeof overtime_rates] ?? 0);
    const factor = SURCHARGE_TYPES.has(type) ? rate : 1 + rate;
    return {
      ...base,
      kind: 'earning',
      amount: round(hourly_value * hours * factor),
      percentage: rate,
    };
  }

  switch (type) {
    case 'vacation':
    case 'leave_paid':
    case 'bereavement_leave':
      // Employer-borne paid absences: no reimbursement.
      return {
        ...base,
        kind: 'earning',
        amount: round(daily_value * days),
        employer_amount: round(daily_value * days),
        reimbursable_amount: 0,
      };

    case 'incapacity_general': {
      // Days 1-2 are borne by the employer; day 3+ is reimbursed by the EPS,
      // with a per-day floor of 1 SMMLV / 30.
      const rate =
        percentage_override > 0 ? percentage_override : incapacity_general_rate;
      const daily_payment = daily_value * rate;
      const employer_days = Math.min(days, INCAPACITY_EMPLOYER_DAYS);
      const eps_days = Math.max(days - INCAPACITY_EMPLOYER_DAYS, 0);
      const eps_daily_floor = rules.minimum_wage / 30;
      const eps_daily = Math.max(daily_payment, eps_daily_floor);
      const employer_amount = round(daily_payment * employer_days);
      const reimbursable_amount = round(eps_daily * eps_days);
      return {
        ...base,
        kind: 'earning',
        amount: round(employer_amount + reimbursable_amount),
        percentage: rate,
        employer_amount,
        reimbursable_amount,
        ...(reimbursable_amount > 0 ? { reimbursed_by: 'eps' as const } : {}),
      };
    }

    case 'incapacity_laboral':
      // ARL incapacity: paid at 100% of the daily salary and reimbursed by the
      // ARL from day 1 (never an employer cost).
      return {
        ...base,
        kind: 'earning',
        amount: round(daily_value * days),
        employer_amount: 0,
        reimbursable_amount: round(daily_value * days),
        reimbursed_by: 'arl',
      };

    case 'maternity_leave':
    case 'paternity_leave':
      // Maternity/paternity leave: paid at 100% of the daily salary and borne
      // by the EPS (a reimbursement, not an employer cost).
      return {
        ...base,
        kind: 'earning',
        amount: round(daily_value * days),
        employer_amount: 0,
        reimbursable_amount: round(daily_value * days),
        reimbursed_by: 'eps',
      };

    case 'leave_unpaid':
      // No payment: reduces worked days before proration.
      return {
        ...base,
        kind: 'days_adjustment',
        amount: 0,
        days,
      };

    case 'bonus':
    case 'commission':
      return {
        ...base,
        kind: 'earning',
        amount: round(manual_amount),
      };

    case 'other_deduction':
      return {
        ...base,
        kind: 'deduction',
        amount: round(manual_amount),
      };

    default:
      throw new Error(
        `valuateNovelty: unsupported novelty type '${type}' (novelty #${novelty.id})`,
      );
  }
}

import { PayrollRules } from './interfaces/payroll-rules.interface';
import {
  DEFAULT_MONTHLY_HOURS,
  DEFAULT_OVERTIME_RATES,
  DEFAULT_INCAPACITY_GENERAL_EMPLOYER_RATE,
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
 * - Incapacity (general illness) = (base_salary / 30) × days × 66.67% (employer share)
 * - Incapacity (labor/ARL)       = (base_salary / 30) × days (100%)
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
      return {
        ...base,
        kind: 'earning',
        amount: round(daily_value * days),
      };

    case 'incapacity_general': {
      const rate =
        percentage_override > 0 ? percentage_override : incapacity_general_rate;
      return {
        ...base,
        kind: 'earning',
        amount: round(daily_value * days * rate),
        percentage: rate,
      };
    }

    case 'incapacity_laboral':
      // ARL incapacity: paid at 100% of the daily salary.
      return {
        ...base,
        kind: 'earning',
        amount: round(daily_value * days),
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

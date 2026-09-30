/**
 * Periodicidades de cierre contable soportadas (conjunto cerrado).
 *
 * Alineadas a periodos fiscales DIAN reales — NO existe cierre trimestral ni
 * semestral. Reutiliza la misma convención de periodicidad que el IVA
 * (ver `fiscal-obligation.service.ts`: VAT_BIMONTHLY_MONTHS [2,4,6,8,10,12] y
 * VAT_FOUR_MONTHLY_MONTHS [4,8,12]).
 */
export const FISCAL_CLOSE_TYPES = [
  'monthly',
  'bimonthly',
  'four_monthly',
  'annual',
] as const;

export type FiscalCloseType = (typeof FISCAL_CLOSE_TYPES)[number];

/**
 * Meses de cierre por periodicidad multi-mes. El `period_month` recibido es el
 * MES DE CIERRE del periodo (último mes que cubre), igual que el vencimiento de
 * IVA. P.ej. bimestral mes=2 cubre ene-feb; cuatrimestral mes=4 cubre ene-abr.
 */
const BIMONTHLY_CLOSING_MONTHS = [2, 4, 6, 8, 10, 12];
const FOUR_MONTHLY_CLOSING_MONTHS = [4, 8, 12];

export interface FiscalPeriodInput {
  period_year: number;
  period_month?: number | null;
  period_quarter?: number | null;
  periodicity?: FiscalCloseType | null;
  close_type?: FiscalCloseType | string | null;
}

export interface FiscalPeriodRange {
  period_year: number;
  period_month: number | null;
  period_quarter: number | null;
  period_start: Date;
  period_end: Date;
}

/**
 * Resuelve el rango UTC [period_start, period_end] (ambos midnight UTC,
 * inclusivos) para un periodo fiscal.
 *
 * `periodicity` is canonical for declarations/obligations; `close_type` is a
 * compatibility input for close sessions. If neither is supplied, legacy
 * month/quarter/year inference remains available.
 *
 * Ejemplos:
 *  - bimonthly,   year=2026, month=2 → 2026-01-01 .. 2026-02-28/29
 *  - four_monthly, year=2026, month=4 → 2026-01-01 .. 2026-04-30
 */
export function resolveFiscalPeriodRange(
  input: FiscalPeriodInput,
): FiscalPeriodRange {
  const year = input.period_year;
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError('period_year must be an integer from 1 through 9999');
  }

  const validateBoundedInteger = (
    name: string,
    value: number | null | undefined,
    min: number,
    max: number,
  ) => {
    if (
      value != null &&
      (!Number.isInteger(value) || value < min || value > max)
    ) {
      throw new RangeError(`${name} must be an integer from ${min} through ${max}`);
    }
  };
  validateBoundedInteger('period_month', input.period_month, 1, 12);
  validateBoundedInteger('period_quarter', input.period_quarter, 1, 4);

  const allowedTypes: readonly string[] = FISCAL_CLOSE_TYPES;
  if (input.periodicity != null && !allowedTypes.includes(input.periodicity)) {
    throw new RangeError(`Unsupported fiscal periodicity: ${input.periodicity}`);
  }
  if (input.close_type != null && !allowedTypes.includes(input.close_type)) {
    throw new RangeError(`Unsupported fiscal close_type: ${input.close_type}`);
  }
  if (
    input.periodicity != null &&
    input.close_type != null &&
    input.periodicity !== input.close_type
  ) {
    throw new RangeError(
      'periodicity and close_type must match when both are supplied',
    );
  }

  const periodicity = input.periodicity ?? input.close_type ?? null;
  if (periodicity != null && input.period_quarter != null) {
    throw new RangeError(
      'period_quarter cannot be combined with an explicit periodicity',
    );
  }

  if (periodicity === 'annual') {
    return {
      period_year: year,
      period_month: null,
      period_quarter: null,
      period_start: utcDate(year, 0, 1),
      period_end: utcDate(year, 11, 31),
    };
  }

  if (periodicity === 'monthly' && input.period_month == null) {
    throw new RangeError('period_month is required for monthly periodicity');
  }
  if (
    (periodicity === 'bimonthly' || periodicity === 'four_monthly') &&
    input.period_month == null
  ) {
    throw new RangeError(`period_month is required for ${periodicity} periodicity`);
  }

  if (
    (periodicity === 'bimonthly' || periodicity === 'four_monthly') &&
    input.period_month != null
  ) {
    const span = periodicity === 'bimonthly' ? 2 : 4;
    const closingMonths =
      periodicity === 'bimonthly'
        ? BIMONTHLY_CLOSING_MONTHS
        : FOUR_MONTHLY_CLOSING_MONTHS;
    // Normaliza al mes de cierre del periodo que contiene a period_month
    // (tolerante a que llegue un mes intermedio, p.ej. ene → bimestre feb).
    const closingMonth =
      closingMonths.find((m) => input.period_month! <= m) ??
      closingMonths[closingMonths.length - 1];
    const startMonthIndex = closingMonth - span; // 0-based start month
    const start = utcDate(year, startMonthIndex, 1);
    const end = utcDate(year, closingMonth, 0);
    return {
      period_year: year,
      period_month: closingMonth,
      period_quarter: null,
      period_start: start,
      period_end: end,
    };
  }

  if (
    periodicity === 'monthly' ||
    (periodicity == null && input.period_month != null)
  ) {
    const month = input.period_month!;
    const start = utcDate(year, month - 1, 1);
    const end = utcDate(year, month, 0);
    return {
      period_year: year,
      period_month: month,
      period_quarter: null,
      period_start: start,
      period_end: end,
    };
  }

  if (periodicity == null && input.period_quarter != null) {
    const startMonth = (input.period_quarter - 1) * 3;
    const start = utcDate(year, startMonth, 1);
    const end = utcDate(year, startMonth + 3, 0);
    return {
      period_year: year,
      period_month: null,
      period_quarter: input.period_quarter,
      period_start: start,
      period_end: end,
    };
  }

  return {
    period_year: year,
    period_month: null,
    period_quarter: null,
    period_start: utcDate(year, 0, 1),
    period_end: utcDate(year, 11, 31),
  };
}

/** Date.UTC treats years 0–99 as 1900–1999; use setUTCFullYear instead. */
function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  return date;
}

export function defaultMonthlyDueDate(periodEnd: Date, day = 20): Date {
  return new Date(
    Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, day),
  );
}

export function defaultAnnualDueDate(year: number, month = 4, day = 30): Date {
  return new Date(Date.UTC(year + 1, month - 1, day));
}

export function buildDateRangeFilter(start: Date, end: Date) {
  return {
    gte: start,
    lt: new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1),
    ),
  };
}

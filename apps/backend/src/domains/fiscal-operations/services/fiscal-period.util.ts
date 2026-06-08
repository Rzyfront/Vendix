export interface FiscalPeriodInput {
  period_year: number;
  period_month?: number | null;
  period_quarter?: number | null;
}

export interface FiscalPeriodRange {
  period_year: number;
  period_month: number | null;
  period_quarter: number | null;
  period_start: Date;
  period_end: Date;
}

export function resolveFiscalPeriodRange(
  input: FiscalPeriodInput,
): FiscalPeriodRange {
  if (input.period_month) {
    const start = new Date(Date.UTC(input.period_year, input.period_month - 1, 1));
    const end = new Date(Date.UTC(input.period_year, input.period_month, 0));
    return {
      period_year: input.period_year,
      period_month: input.period_month,
      period_quarter: null,
      period_start: start,
      period_end: end,
    };
  }

  if (input.period_quarter) {
    const startMonth = (input.period_quarter - 1) * 3;
    const start = new Date(Date.UTC(input.period_year, startMonth, 1));
    const end = new Date(Date.UTC(input.period_year, startMonth + 3, 0));
    return {
      period_year: input.period_year,
      period_month: null,
      period_quarter: input.period_quarter,
      period_start: start,
      period_end: end,
    };
  }

  return {
    period_year: input.period_year,
    period_month: null,
    period_quarter: null,
    period_start: new Date(Date.UTC(input.period_year, 0, 1)),
    period_end: new Date(Date.UTC(input.period_year, 11, 31)),
  };
}

export function defaultMonthlyDueDate(periodEnd: Date, day = 20): Date {
  return new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, day));
}

export function defaultAnnualDueDate(year: number, month = 4, day = 30): Date {
  return new Date(Date.UTC(year + 1, month - 1, day));
}

export function buildDateRangeFilter(start: Date, end: Date) {
  return {
    gte: start,
    lt: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1)),
  };
}

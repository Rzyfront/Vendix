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
 * Precedencia:
 *  1. close_type multi-mes (bimonthly / four_monthly) cuando hay period_month
 *     → cubre N meses terminando en el mes de cierre indicado.
 *  2. period_month (mensual).
 *  3. period_quarter (trimestral — usado por obligaciones, no por cierre).
 *  4. anual (sin month ni quarter).
 *
 * Ejemplos:
 *  - bimonthly,   year=2026, month=2 → 2026-01-01 .. 2026-02-28/29
 *  - four_monthly, year=2026, month=4 → 2026-01-01 .. 2026-04-30
 */
export function resolveFiscalPeriodRange(
  input: FiscalPeriodInput,
): FiscalPeriodRange {
  if (
    (input.close_type === 'bimonthly' ||
      input.close_type === 'four_monthly') &&
    input.period_month
  ) {
    const span = input.close_type === 'bimonthly' ? 2 : 4;
    const closingMonths =
      input.close_type === 'bimonthly'
        ? BIMONTHLY_CLOSING_MONTHS
        : FOUR_MONTHLY_CLOSING_MONTHS;
    // Normaliza al mes de cierre del periodo que contiene a period_month
    // (tolerante a que llegue un mes intermedio, p.ej. ene → bimestre feb).
    const closingMonth =
      closingMonths.find((m) => input.period_month! <= m) ??
      closingMonths[closingMonths.length - 1];
    const startMonthIndex = closingMonth - span; // 0-based start month
    const start = new Date(Date.UTC(input.period_year, startMonthIndex, 1));
    const end = new Date(Date.UTC(input.period_year, closingMonth, 0));
    return {
      period_year: input.period_year,
      period_month: closingMonth,
      period_quarter: null,
      period_start: start,
      period_end: end,
    };
  }

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

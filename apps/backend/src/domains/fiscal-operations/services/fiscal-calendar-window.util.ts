import { VatPeriodicity } from '../constants/fiscal-responsibilities.catalog';

/**
 * Ventana del calendario tributario → bitácora. Puro: recibe la fecha civil de
 * hoy (America/Bogota) y devuelve los periodos candidatos por su MES DE CIERRE
 * (misma convención que `resolveFiscalPeriodRange` y el calendario DIAN).
 */

export interface FiscalCalendarPeriodRef {
  period_year: number;
  /** Mes de cierre del periodo (1-12). */
  period_month: number;
}

const CLOSING_MONTHS: Record<VatPeriodicity, number[]> = {
  monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  bimonthly: [2, 4, 6, 8, 10, 12],
  four_monthly: [4, 8, 12],
};

function compare(a: FiscalCalendarPeriodRef, b: FiscalCalendarPeriodRef) {
  return a.period_year - b.period_year || a.period_month - b.period_month;
}

function nextClosing(
  periodicity: VatPeriodicity,
  from: FiscalCalendarPeriodRef,
): FiscalCalendarPeriodRef {
  const months = CLOSING_MONTHS[periodicity];
  const later = months.find((m) => m > from.period_month);
  return later
    ? { period_year: from.period_year, period_month: later }
    : { period_year: from.period_year + 1, period_month: months[0] };
}

function previousClosing(
  periodicity: VatPeriodicity,
  from: FiscalCalendarPeriodRef,
): FiscalCalendarPeriodRef {
  const months = CLOSING_MONTHS[periodicity];
  const earlier = [...months].reverse().find((m) => m < from.period_month);
  return earlier
    ? { period_year: from.period_year, period_month: earlier }
    : { period_year: from.period_year - 1, period_month: months[months.length - 1] };
}

/** Periodo abierto hoy: el primero cuyo mes de cierre es >= el mes actual. */
export function currentOpenPeriod(
  periodicity: VatPeriodicity,
  today: { year: number; month: number },
): FiscalCalendarPeriodRef {
  const months = CLOSING_MONTHS[periodicity];
  const closing = months.find((m) => m >= today.month)!;
  return { period_year: today.year, period_month: closing };
}

/**
 * Candidatos en orden: último periodo cerrado (su declaración es la próxima en
 * vencer), periodo en curso y el siguiente. Quien llama descarta el cerrado si
 * su vencimiento oficial ya pasó.
 */
export function vatWindowCandidates(
  periodicity: VatPeriodicity,
  today: { year: number; month: number },
): {
  last_closed: FiscalCalendarPeriodRef;
  current: FiscalCalendarPeriodRef;
  next: FiscalCalendarPeriodRef;
} {
  const current = currentOpenPeriod(periodicity, today);
  return {
    last_closed: previousClosing(periodicity, current),
    current,
    next: nextClosing(periodicity, current),
  };
}

/** Último día (UTC, @db.Date) del periodo que cierra en `ref`. */
export function periodEndDate(ref: FiscalCalendarPeriodRef): Date {
  return new Date(Date.UTC(ref.period_year, ref.period_month, 0));
}

export function samePeriod(
  a: FiscalCalendarPeriodRef,
  b: FiscalCalendarPeriodRef,
): boolean {
  return compare(a, b) === 0;
}

export function normalizeVatPeriodicity(value: unknown): VatPeriodicity | null {
  return value === 'monthly' || value === 'bimonthly' || value === 'four_monthly'
    ? value
    : null;
}

/**
 * Aritmética de fechas calendario `YYYY-MM-DD` (sin zona horaria). Se calcula
 * en UTC solo para evitar saltos por el huso del navegador; el "hoy" de la
 * tienda viene de `storeToday(tz)` (ver vendix-date-timezone).
 */

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(ymd: string, days: number): string {
  const d = toUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana que contiene la fecha. */
export function mondayOf(ymd: string): string {
  const dow = toUtc(ymd).getUTCDay(); // 0 = domingo
  return addDays(ymd, -((dow + 6) % 7));
}

const WEEKDAY = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'short' });
const DAY_MONTH = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const FULL = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function weekdayShort(ymd: string): string {
  return WEEKDAY.format(toUtc(ymd));
}
export function dayMonth(ymd: string): string {
  return DAY_MONTH.format(toUtc(ymd));
}
export function fullDate(ymd: string): string {
  return FULL.format(toUtc(ymd));
}

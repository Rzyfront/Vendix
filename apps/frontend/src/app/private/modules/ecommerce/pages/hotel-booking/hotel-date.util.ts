/** Local `YYYY-MM-DD` of a date (never via toISOString, which shifts the day in UTC). */
export function toDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Local date `offset` days from today, as `YYYY-MM-DD`. */
export function dateFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toDateString(d);
}

/** Date-only display (`YYYY-MM-DD`) built from its parts: no off-by-one from UTC parsing. */
export function formatDateOnly(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Human message of an HTTP error `{ message }`. */
export function apiMessage(err: unknown, fallback: string): string {
  const message = (err as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return fallback;
}

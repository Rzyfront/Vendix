const DATE_FORMATTER = new Intl.DateTimeFormat('es-CO', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const TIME_FORMATTER = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
});

const DATETIME_FORMATTER = new Intl.DateTimeFormat('es-CO', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// UTC-stable formatter (espejo de `formatDateOnlyUTC` del web).
// Garantiza que timestamps de auditoría no varíen por zona horaria del
// dispositivo — crítico para logs forenses / legales.
const DATETIME_UTC_FORMATTER = new Intl.DateTimeFormat('es-CO', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  return DATE_FORMATTER.format(d);
}

export function formatTime(date: Date | string | number): string {
  const d = new Date(date);
  return TIME_FORMATTER.format(d);
}

export function formatDateTime(date: Date | string | number): string {
  const d = new Date(date);
  return DATETIME_FORMATTER.format(d);
}

/**
 * Formato de fecha+hora **estable en UTC** (espejo del web
 * `formatDateOnlyUTC`). Usar para timestamps de auditoría donde la
 * zona horaria del dispositivo no debe alterar el valor mostrado.
 *
 * Output: `DD/MM/YYYY, HH:MM:SS` en es-CO.
 */
export function formatDateTimeUTC(date: Date | string | number): string {
  const d = new Date(date);
  return DATETIME_UTC_FORMATTER.format(d);
}

export function formatFullDate(date: Date | string | number): string {
  const d = new Date(date);
  return FULL_DATE_FORMATTER.format(d);
}

export function formatRelative(date: Date | string | number): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return formatDate(d);
}

export function isToday(date: Date | string | number): boolean {
  const d = new Date(date);
  const today = new Date();
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
}

export function isYesterday(date: Date | string | number): boolean {
  const d = new Date(date);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  );
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Días de la semana de una promoción. Misma convención que el backend
 * (`promotion-schedule.util.ts`): 0 = domingo … 6 = sábado, evaluados en la
 * zona horaria de la tienda. Lista vacía = todos los días.
 */
export interface WeekdayOption {
  value: number;
  /** Letra del chip (L M M J V S D). */
  short: string;
  /** Abreviatura para listados ("Mar"). */
  abbr: string;
  /** Nombre completo, para aria-label y mensajes. */
  name: string;
}

/** Orden de la semana colombiana: lunes primero. */
export const PROMOTION_WEEKDAYS: readonly WeekdayOption[] = [
  { value: 1, short: 'L', abbr: 'Lun', name: 'lunes' },
  { value: 2, short: 'M', abbr: 'Mar', name: 'martes' },
  { value: 3, short: 'M', abbr: 'Mié', name: 'miércoles' },
  { value: 4, short: 'J', abbr: 'Jue', name: 'jueves' },
  { value: 5, short: 'V', abbr: 'Vie', name: 'viernes' },
  { value: 6, short: 'S', abbr: 'Sáb', name: 'sábado' },
  { value: 0, short: 'D', abbr: 'Dom', name: 'domingo' },
];

export const ALL_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

export const WEEKDAY_PRESETS: ReadonlyArray<{
  key: string;
  label: string;
  days: readonly number[];
}> = [
  { key: 'all', label: 'Todos', days: [] },
  { key: 'weekdays', label: 'Entre semana', days: [1, 2, 3, 4, 5] },
  { key: 'weekend', label: 'Fin de semana', days: [0, 6] },
];

/** Enteros 0..6, sin repetir, ordenados; los 7 días se guardan como `[]`. */
export function normalizeWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<number>();
  for (const raw of value) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  const days = Array.from(set).sort((a, b) => a - b);
  return days.length === ALL_WEEKDAYS.length ? [] : days;
}

/** "Mar · Mié · Vie" para listados, "Todos los días" si no hay restricción. */
export function formatWeekdaysShort(value: unknown): string {
  const days = normalizeWeekdays(value);
  if (days.length === 0) return 'Todos los días';
  if (sameDays(days, [1, 2, 3, 4, 5])) return 'Entre semana';
  if (sameDays(days, [0, 6])) return 'Fin de semana';
  return PROMOTION_WEEKDAYS.filter((d) => days.includes(d.value))
    .map((d) => d.abbr)
    .join(' · ');
}

/** "martes, miércoles y viernes" para frases completas. */
export function formatWeekdaysLong(value: unknown): string {
  const names = PROMOTION_WEEKDAYS.filter((d) =>
    normalizeWeekdays(value).includes(d.value),
  ).map((d) => d.name);
  if (names.length === 0) return 'todos los días';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

export function sameDays(a: readonly number[], b: readonly number[]): boolean {
  const na = normalizeWeekdays(a as number[]);
  const nb = normalizeWeekdays(b as number[]);
  return na.length === nb.length && na.every((d, i) => d === nb[i]);
}

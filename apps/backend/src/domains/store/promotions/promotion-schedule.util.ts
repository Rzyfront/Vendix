import {
  DEFAULT_STORE_TIMEZONE,
  localCivil,
  resolveTimezoneCascade,
} from 'src/common/utils/store-timezone.util';

/**
 * Calendario de una promoción, evaluado en la ZONA HORARIA DE LA TIENDA.
 *
 * Las fechas de una promoción son fechas de calendario de la tienda: el admin
 * elige "del 1 al 30 de noviembre" con un `<input type="date">`, que viaja
 * como `YYYY-MM-DD` y Prisma guarda como medianoche UTC en una columna
 * `Timestamp` sin zona. Compararlas con `new Date()` (UTC del servidor) corría
 * la vigencia 5 horas en Bogotá: la promo arrancaba el día anterior a las
 * 19:00 y dejaba de aplicar el último día desde las 19:00 del día previo.
 *
 * Por eso el motor no compara contra el instante UTC sino contra el RELOJ DE
 * PARED de la tienda expresado en el mismo espacio "naive" de la columna:
 *  - `wall_now`  : hora local de la tienda leída como si fuera UTC.
 *  - `day_start` : medianoche del día local (para que `end_date` incluya
 *                  todo su día de calendario).
 *  - `weekday`   : día local de la semana, 0 = domingo … 6 = sábado.
 */
export interface PromotionClock {
  wall_now: Date;
  day_start: Date;
  weekday: number;
  timezone: string;
}

export const ALL_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

const WEEKDAY_NAMES_ES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

/** Construye el reloj de la tienda a partir de un instante real. */
export function buildPromotionClock(
  now: Date,
  timezone?: string | null,
): PromotionClock {
  const tz = resolveTimezoneCascade(timezone);
  let civil;
  let effectiveTz = tz;
  try {
    civil = localCivil(now, tz);
  } catch {
    // Un identificador con forma válida pero desconocido por ICU lanza
    // RangeError: la tienda cae a la zona por defecto en vez de no cotizar.
    effectiveTz = DEFAULT_STORE_TIMEZONE;
    civil = localCivil(now, DEFAULT_STORE_TIMEZONE);
  }
  const wall_now = new Date(
    Date.UTC(
      civil.year,
      civil.month - 1,
      civil.day,
      civil.hour,
      civil.minute,
      civil.second,
      now.getUTCMilliseconds(),
    ),
  );
  const day_start = new Date(
    Date.UTC(civil.year, civil.month - 1, civil.day),
  );
  return {
    wall_now,
    day_start,
    weekday: day_start.getUTCDay(),
    timezone: effectiveTz,
  };
}

/**
 * Filtro Prisma de vigencia por fechas: empezó (hora local) y su `end_date`
 * no es anterior al día local de hoy (el día de fin cuenta completo).
 */
export function promotionDateWindowWhere(clock: PromotionClock) {
  return {
    start_date: { lte: clock.wall_now },
    OR: [{ end_date: null }, { end_date: { gte: clock.day_start } }],
  };
}

/** Normaliza la lista de días: enteros 0..6, sin duplicados, ordenados.
 *  Los 7 días equivalen a "todos" y se guardan como lista vacía para tener
 *  una sola representación. */
export function normalizeActiveWeekdays(
  value: Array<number | string | null | undefined> | null | undefined,
): number[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<number>();
  for (const raw of value) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  const days = Array.from(set).sort((a, b) => a - b);
  return days.length === ALL_WEEKDAYS.length ? [] : days;
}

/** ¿La promoción aplica en este día local? Vacío/null = todos los días. */
export function isPromotionActiveOnWeekday(
  promotion: { active_weekdays?: number[] | null },
  weekday: number,
): boolean {
  const days = promotion?.active_weekdays;
  if (!Array.isArray(days) || days.length === 0) return true;
  return days.map(Number).includes(weekday);
}

/** "martes, miércoles y viernes" — para mensajes al usuario. */
export function formatWeekdaysEs(days: number[] | null | undefined): string {
  const names = normalizeActiveWeekdays(days).map((d) => WEEKDAY_NAMES_ES[d]);
  if (names.length === 0) return 'todos los días';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

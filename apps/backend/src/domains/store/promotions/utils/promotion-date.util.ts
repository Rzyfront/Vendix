import {
  DEFAULT_STORE_TIMEZONE,
  localCivil,
  resolveTimezoneCascade,
} from 'src/common/utils/store-timezone.util';

/**
 * Normaliza las fechas que el cliente envía para una promoción al espacio
 * "reloj de pared de la tienda" en el que vive la columna (ver
 * `promotion-schedule.util.ts`): un `Timestamp` sin zona cuyos componentes UTC
 * SON la fecha/hora local de la tienda. El motor compara contra `wall_now`
 * (hora local leída como UTC), así que aquí NUNCA se guarda el instante UTC
 * real: guardarlo correría la vigencia el offset de la tienda.
 *
 * Formas aceptadas:
 *  - `YYYY-MM-DD` (sin hora) → día de calendario de la tienda completo:
 *      inicio = 00:00:00.000, fin = 23:59:59.999 de ese día.
 *  - `YYYY-MM-DDTHH:mm[:ss[.SSS]]` sin zona → hora de pared de la tienda.
 *  - ISO con `Z` u offset → instante real; se respeta y se traduce a la hora
 *    de pared de la tienda con el offset REAL de su zona en ese instante
 *    (DST incluido, vía `Intl`), no con un -05:00 fijo.
 *  - Medianoche UTC exacta con `Z` → fecha de calendario (forma heredada que
 *    produce `new Date('YYYY-MM-DD')`; mismo criterio que `formatStoreDate`).
 */
export type PromotionDateBound = 'start' | 'end';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const UTC_MIDNIGHT = /^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.0{1,3})?)?Z$/;

const DAY_END = [23, 59, 59, 999] as const;

function calendarDay(
  year: number,
  month: number,
  day: number,
  bound: PromotionDateBound,
): Date {
  return bound === 'end'
    ? new Date(Date.UTC(year, month - 1, day, ...DAY_END))
    : new Date(Date.UTC(year, month - 1, day));
}

/**
 * Un fin a las 00:00 exactas se confundiría con la forma heredada "todo el
 * día" (fin guardado a medianoche): se guarda como el último milisegundo del
 * día anterior, que es lo que significa "termina a las 00:00".
 */
function closeEndBound(wall: Date, bound: PromotionDateBound): Date {
  if (bound !== 'end') return wall;
  const isMidnight =
    wall.getUTCHours() === 0 &&
    wall.getUTCMinutes() === 0 &&
    wall.getUTCSeconds() === 0 &&
    wall.getUTCMilliseconds() === 0;
  return isMidnight ? new Date(wall.getTime() - 1) : wall;
}

export function normalizePromotionDate(
  value: string,
  bound: PromotionDateBound,
  timezone?: string | null,
): Date {
  const raw = String(value).trim();

  const dateOnly = DATE_ONLY.exec(raw) ?? UTC_MIDNIGHT.exec(raw);
  if (dateOnly) {
    return calendarDay(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
      bound,
    );
  }

  const wall = WALL_DATETIME.exec(raw);
  if (wall) {
    return closeEndBound(
      new Date(
        Date.UTC(
          Number(wall[1]),
          Number(wall[2]) - 1,
          Number(wall[3]),
          Number(wall[4]),
          Number(wall[5]),
          Number(wall[6] ?? 0),
          Number((wall[7] ?? '0').padEnd(3, '0')),
        ),
      ),
      bound,
    );
  }

  // ISO con zona explícita: instante real → hora de pared de la tienda.
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return instant;
  const tz = resolveTimezoneCascade(timezone);
  let civil: ReturnType<typeof localCivil>;
  try {
    civil = localCivil(instant, tz);
  } catch {
    civil = localCivil(instant, DEFAULT_STORE_TIMEZONE);
  }
  return closeEndBound(
    new Date(
      Date.UTC(
        civil.year,
        civil.month - 1,
        civil.day,
        civil.hour,
        civil.minute,
        civil.second,
        instant.getUTCMilliseconds(),
      ),
    ),
    bound,
  );
}

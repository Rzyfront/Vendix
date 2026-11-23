/**
 * Fechas de una promoción en el frontend.
 *
 * El backend guarda `start_date`/`end_date` como RELOJ DE PARED DE LA TIENDA
 * en una columna sin zona: los componentes UTC del ISO que devuelve la API SON
 * la fecha y hora local de la tienda (ver `promotion-schedule.util.ts` en el
 * backend). Por eso aquí se leen siempre con los componentes UTC, sin
 * convertir a la zona del navegador ni de la tienda.
 *
 * "Todo el día" (sin hora) se representa como inicio 00:00 y fin 23:59:59.999
 * — o fin a medianoche en las promos guardadas antes de la hora opcional.
 */
export type PromotionDateBound = 'start' | 'end';

export interface PromotionDateParts {
  /** `YYYY-MM-DD` para `<input type="date">`; vacío si no hay fecha. */
  date: string;
  /** `HH:mm` para `<input type="time">`; vacío = todo el día. */
  time: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Separa el valor de la API en fecha y hora (vacía = todo el día). */
export function splitPromotionDate(
  value: string | null | undefined,
  bound: PromotionDateBound,
): PromotionDateParts {
  if (!value) return { date: '', time: '' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  const isMidnight = h === 0 && m === 0 && s === 0;
  const isDayEnd = h === 23 && m === 59 && s === 59;
  const allDay = isMidnight || (bound === 'end' && isDayEnd);
  return { date, time: allDay ? '' : `${pad2(h)}:${pad2(m)}` };
}

/**
 * Offset UTC (`+HH:MM` / `-HH:MM`) de `tz` para una hora de pared local.
 * Se deriva con `Intl` del offset real de la zona en ese momento (DST
 * incluido); nunca un -05:00 fijo.
 */
export function storeOffsetForWallClock(
  date: string,
  time: string,
  tz: string,
): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (utcMs: number): number => {
    const parts: Record<string, number> = {};
    for (const p of new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(utcMs))) {
      if (p.type !== 'literal') parts[p.type] = Number(p.value);
    }
    return (
      Date.UTC(
        parts['year'],
        parts['month'] - 1,
        parts['day'],
        parts['hour'],
        parts['minute'],
        parts['second'],
      ) - utcMs
    );
  };
  // Dos pasadas: el offset en el instante resultante puede diferir del
  // primer estimado al cruzar un cambio de horario.
  const offset = offsetAt(asUtc - offsetAt(asUtc));
  const total = Math.round(offset / 60000);
  const sign = total < 0 ? '-' : '+';
  const abs = Math.abs(total);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * Valor que se envía a la API: sin hora → `YYYY-MM-DD` (el backend lo toma
 * como el día completo de la tienda); con hora → ISO con el offset de la zona
 * de la tienda.
 */
export function buildPromotionDate(
  date: string,
  time: string | null | undefined,
  tz: string,
): string {
  if (!date || !time) return date;
  const hhmm = time.slice(0, 5);
  let offset: string;
  try {
    offset = storeOffsetForWallClock(date, hhmm, tz);
  } catch {
    // Zona desconocida para el navegador: sin offset, el backend interpreta
    // la hora como hora de la tienda.
    return `${date}T${hhmm}:00`;
  }
  return `${date}T${hhmm}:00${offset}`;
}

/** `dd/MM/yyyy`, y `dd/MM/yyyy HH:mm` cuando la promo tiene hora. */
export function formatPromotionDate(
  value: string | null | undefined,
  bound: PromotionDateBound,
): string {
  const { date, time } = splitPromotionDate(value, bound);
  if (!date) return '';
  const [y, m, d] = date.split('-');
  return time ? `${d}/${m}/${y} ${time}` : `${d}/${m}/${y}`;
}

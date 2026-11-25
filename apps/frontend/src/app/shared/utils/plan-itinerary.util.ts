/**
 * QUI-1060 F2 · Itinerario de un plan de varios días: armado por día y fechas.
 * Lo usan el bloque «Itinerario» del panel, la ficha pública y el comprobante.
 * Fechas `YYYY-MM-DD` siempre en aritmética UTC (sin corrimiento de un día).
 */

/** Lo mínimo de una actividad que decide su lugar en el itinerario. */
export interface ItineraryActivityLike {
  id?: number;
  day_number: number;
  sort_order?: number;
  start_time: string | null;
}

export interface ItineraryDay<T> {
  day_number: number;
  /** Fecha real del día (`YYYY-MM-DD`) o null si no hay fecha de inicio. */
  date: string | null;
  activities: T[];
}

/** Orden: día, orden manual, hora (sin hora al final) e id. Igual que el backend. */
export function compareItineraryActivities(a: ItineraryActivityLike, b: ItineraryActivityLike): number {
  if (a.day_number !== b.day_number) return a.day_number - b.day_number;
  const ao = a.sort_order ?? 0;
  const bo = b.sort_order ?? 0;
  if (ao !== bo) return ao - bo;
  const at = a.start_time ?? '99:99';
  const bt = b.start_time ?? '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return (a.id ?? 0) - (b.id ?? 0);
}

/** `YYYY-MM-DD` + n días. */
export function addDaysToIsoDate(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const value = new Date(Date.UTC(y, m - 1, d + days));
  return value.toISOString().slice(0, 10);
}

/** Fecha real del día N de un plan que empieza en `startDate` (día 1 = inicio). */
export function itineraryDayDate(startDate: string, dayNumber: number): string {
  return addDaysToIsoDate(startDate, dayNumber - 1);
}

/**
 * Días 1..`durationDays` con sus actividades en orden. Con `includeEmpty` salen
 * también los días sin actividades (panel); sin él, solo los que tienen alguna
 * (ficha y comprobante). Las actividades fuera de la duración se descartan.
 */
export function groupItineraryByDay<T extends ItineraryActivityLike>(
  activities: readonly T[],
  durationDays: number | null | undefined,
  options: { startDate?: string | null; includeEmpty?: boolean } = {},
): ItineraryDay<T>[] {
  const total = durationDays && durationDays > 0 ? Math.floor(durationDays) : 0;
  const sorted = [...activities].sort(compareItineraryActivities);
  const days: ItineraryDay<T>[] = [];
  for (let day = 1; day <= total; day++) {
    const list = sorted.filter((a) => a.day_number === day);
    if (list.length === 0 && !options.includeEmpty) continue;
    days.push({
      day_number: day,
      date: options.startDate ? itineraryDayDate(options.startDate, day) : null,
      activities: list,
    });
  }
  return days;
}

/** Actividades guardadas en días que ya no existen (la duración se bajó en el formulario). */
export function activitiesOutsideDuration<T extends ItineraryActivityLike>(
  activities: readonly T[],
  durationDays: number | null | undefined,
): T[] {
  const total = durationDays && durationDays > 0 ? durationDays : 0;
  return activities.filter((a) => a.day_number > total).sort(compareItineraryActivities);
}

/** «sáb, 10 mar 2099» sin corrimiento por zona horaria. */
export function formatItineraryDate(date: string | null | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-CO', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** «3 días / 2 noches», «1 día». */
export function formatPlanDuration(days: number | null | undefined, nights?: number | null): string {
  if (!days) return '';
  const d = `${days} ${days === 1 ? 'día' : 'días'}`;
  if (nights == null || nights <= 0) return d;
  return `${d} / ${nights} ${nights === 1 ? 'noche' : 'noches'}`;
}

import { addDaysToDateString } from '@common/utils/schedule-window.util';

/**
 * QUI-1060 F2: armado puro del itinerario de un plan. Lo usan la ficha pública
 * (sin fechas) y el comprobante de una reserva (día 1 = fecha de inicio).
 */

/** Lo mínimo de una actividad que decide su lugar en el itinerario. */
export interface PlanActivityOrderFields {
  id: number;
  day_number: number;
  sort_order: number;
  start_time: string | null;
}

/** Actividad tal como se guarda; el armado público descarta todo lo interno. */
export interface PlanActivitySource extends PlanActivityOrderFields {
  title: string;
  description: string | null;
  is_public: boolean;
}

/** Lo único de una actividad que ve el cliente: nunca costo, responsable ni contacto. */
export interface PublicPlanActivity {
  start_time: string | null;
  title: string;
  description: string | null;
}

export interface PublicItineraryDay {
  day_number: number;
  /** `YYYY-MM-DD` real del día; null en la ficha (sin fecha de inicio). */
  date: string | null;
  activities: PublicPlanActivity[];
}

/** Orden dentro del itinerario: día, orden manual, hora (sin hora al final) e id. */
export function compareActivities(a: PlanActivityOrderFields, b: PlanActivityOrderFields): number {
  if (a.day_number !== b.day_number) return a.day_number - b.day_number;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  const at = a.start_time ?? '99:99';
  const bt = b.start_time ?? '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id - b.id;
}

/**
 * Itinerario público agrupado por día: solo actividades `is_public` dentro de la
 * duración, solo los días que tienen alguna, en orden. Con `startDate` cada día
 * lleva su fecha real (día N = inicio + N − 1).
 */
export function buildPublicItinerary(
  activities: readonly PlanActivitySource[],
  durationDays: number | null | undefined,
  startDate?: string | null,
): PublicItineraryDay[] {
  const days = durationDays ?? 0;
  const start = startDate ? startDate.slice(0, 10) : null;
  const byDay = new Map<number, PublicPlanActivity[]>();
  for (const activity of [...activities].sort(compareActivities)) {
    if (!activity.is_public || activity.day_number < 1 || activity.day_number > days) continue;
    const list = byDay.get(activity.day_number) ?? [];
    list.push({
      start_time: activity.start_time,
      title: activity.title,
      description: activity.description,
    });
    byDay.set(activity.day_number, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayNumber, list]) => ({
      day_number: dayNumber,
      date: start ? addDaysToDateString(start, dayNumber - 1) : null,
      activities: list,
    }));
}

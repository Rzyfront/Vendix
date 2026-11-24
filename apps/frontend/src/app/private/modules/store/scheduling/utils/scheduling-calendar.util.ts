/**
 * Cálculo puro del calendario de la Agenda (agenda-unificada F1).
 *
 * Todo trabaja con fechas `YYYY-MM-DD` y horas `HH:mm` locales de la tienda
 * que ya trae cada evento; nunca con el reloj del navegador. El "hoy" lo da
 * `storeToday(tz)` o el backend (`/store/scheduling/sources`).
 */
import type { FilterValues } from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { addDays, mondayOf } from '../../scheduled-orders/utils/ymd.util';
import type {
  SchedulingEvent,
  SchedulingEventType,
  SchedulingQuery,
  SchedulingStatusGroup,
} from '../interfaces/scheduling.interface';

export type AgendaView = 'month' | 'week' | 'day';

export interface DateRange {
  from: string;
  to: string;
}

/** Primer día del mes de la fecha. */
export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 8)}01`;
}

/** Último día del mes de la fecha. */
export function monthEnd(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Semanas (lunes a domingo) que cubren el mes de la fecha. */
export function monthGrid(anchor: string): string[][] {
  const first = mondayOf(monthStart(anchor));
  const last = monthEnd(anchor);
  const weeks: string[][] = [];
  let cursor = first;
  while (cursor <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) week.push(addDays(cursor, i));
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

/** Días de la semana (lunes a domingo) de la fecha. */
export function weekDays(anchor: string): string[] {
  const monday = mondayOf(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Rango que pide la vista (el mes incluye los bordes de semana visibles). */
export function rangeForView(view: AgendaView, anchor: string): DateRange {
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') {
    const days = weekDays(anchor);
    return { from: days[0], to: days[6] };
  }
  const weeks = monthGrid(anchor);
  return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
}

/** Mueve la fecha ancla una unidad de la vista (mes, semana o día). */
export function shiftAnchor(view: AgendaView, anchor: string, direction: 1 | -1): string {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  const [y, m] = anchor.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + direction, 1)).toISOString().slice(0, 10);
}

export function minutesOf(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Eventos agrupados por su fecha local de inicio, en orden de hora. */
export function eventsByDay(events: readonly SchedulingEvent[]): Map<string, SchedulingEvent[]> {
  const map = new Map<string, SchedulingEvent[]>();
  for (const event of events) {
    const list = map.get(event.date) ?? [];
    list.push(event);
    map.set(event.date, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.local_start.localeCompare(b.local_start) || a.id.localeCompare(b.id));
  }
  return map;
}

export interface HourRange {
  /** Minutos desde medianoche, múltiplos de 60. */
  start: number;
  end: number;
}

export const DEFAULT_HOUR_RANGE: HourRange = { start: 7 * 60, end: 21 * 60 };

/** Franja horaria visible: la de por defecto, ampliada para que quepa todo. */
export function hourRangeFor(events: readonly SchedulingEvent[]): HourRange {
  let start = DEFAULT_HOUR_RANGE.start;
  let end = DEFAULT_HOUR_RANGE.end;
  for (const event of events) {
    const s = minutesOf(event.local_start);
    const e = event.end_date > event.date ? 24 * 60 : Math.max(minutesOf(event.local_end), s + 30);
    start = Math.min(start, Math.floor(s / 60) * 60);
    end = Math.max(end, Math.ceil(e / 60) * 60);
  }
  return { start, end: Math.min(end, 24 * 60) };
}

export interface PlacedEvent {
  event: SchedulingEvent;
  /** Posición vertical en % de la franja visible. */
  top: number;
  height: number;
  /** Columna dentro de un grupo de eventos que se solapan. */
  lane: number;
  lanes: number;
}

/**
 * Ubica los eventos de un día en la rejilla horaria. Los que se solapan
 * comparten el ancho en carriles; un evento que sigue al día siguiente se
 * corta a medianoche.
 */
export function layoutDay(
  events: readonly SchedulingEvent[],
  range: HourRange,
  minHeightMinutes = 30,
): PlacedEvent[] {
  const span = range.end - range.start;
  const items = events
    .map((event) => {
      const start = minutesOf(event.local_start);
      const rawEnd = event.end_date > event.date ? 24 * 60 : minutesOf(event.local_end);
      const end = Math.max(rawEnd, start + minHeightMinutes);
      return { event, start, end };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placed: PlacedEvent[] = [];
  let group: { item: (typeof items)[number]; lane: number }[] = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = group.reduce((max, g) => Math.max(max, g.lane + 1), 0);
    for (const g of group) {
      placed.push({
        event: g.item.event,
        top: ((g.item.start - range.start) / span) * 100,
        height: ((g.item.end - g.item.start) / span) * 100,
        lane: g.lane,
        lanes,
      });
    }
    group = [];
  };
  for (const item of items) {
    if (group.length && item.start >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    const busy = new Set(group.filter((g) => g.item.end > item.start).map((g) => g.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    group.push({ item, lane });
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) flush();
  return placed;
}

/** Valores del dropdown de filtros → query del backend. */
export function filterValuesToQuery(values: FilterValues): SchedulingQuery {
  const list = (key: string): string[] => {
    const value = values[key];
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
  };
  const types = list('types') as SchedulingEventType[];
  const statusGroups = list('status_groups') as SchedulingStatusGroup[];
  const staff = list('staff_ids')
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  const from = (values['date_start'] as string | null) || undefined;
  const to = (values['date_end'] as string | null) || undefined;
  return {
    ...(types.length && { types }),
    ...(statusGroups.length && { status_groups: statusGroups }),
    ...(staff.length && { staff_ids: staff }),
    ...(from && { from }),
    ...(to && { to }),
  };
}

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
  ProviderDayAvailability,
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

/** Semana y Día de la Agenda: las 24 horas (00:00–24:00). */
export const FULL_DAY_RANGE: HourRange = { start: 0, end: 24 * 60 };

/**
 * Reservas que empezaron el día anterior y terminan en este (cruzan UNA
 * medianoche, p. ej. 23:00–01:00): se pintan también de 00:00 a su fin. Los
 * planes de varios días siguen solo en su primer día.
 */
export function continuationsByDay(events: readonly SchedulingEvent[]): Map<string, SchedulingEvent[]> {
  const map = new Map<string, SchedulingEvent[]>();
  for (const event of events) {
    if (event.end_date !== addDays(event.date, 1) || minutesOf(event.local_end) <= 0) continue;
    const list = map.get(event.end_date) ?? [];
    list.push(event);
    map.set(event.end_date, list);
  }
  return map;
}

/** Minutos desde medianoche y fecha (`YYYY-MM-DD`) de un instante en la zona de la tienda. */
export function storeClock(instant: Date, timeZone: string): { date: string; minutes: number } {
  const parts: Record<string, string> = {};
  try {
    for (const p of new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(instant)) {
      parts[p.type] = p.value;
    }
  } catch {
    return storeClock(instant, '');
  }
  const hour = Number(parts['hour']) % 24;
  return { date: `${parts['year']}-${parts['month']}-${parts['day']}`, minutes: hour * 60 + Number(parts['minute']) };
}

/** Posición (%) de la línea de «ahora» en la franja; -1 cuando queda fuera. */
export function nowLinePercent(minutes: number, range: HourRange): number {
  if (minutes < range.start || minutes > range.end) return -1;
  return ((minutes - range.start) / (range.end - range.start)) * 100;
}

/**
 * `scrollTop` que deja `minutes` a un tercio del alto visible (foco en la
 * hora actual al abrir), sin pasarse de los bordes.
 */
export function focusScrollTop(
  minutes: number,
  range: HourRange,
  scrollHeight: number,
  clientHeight: number,
): number {
  const y = ((minutes - range.start) / (range.end - range.start)) * scrollHeight;
  return Math.round(Math.min(Math.max(y - clientHeight / 3, 0), Math.max(scrollHeight - clientHeight, 0)));
}

/**
 * Clave del auto-foco de Semana/Día: se vuelve a enfocar solo cuando cambia.
 * Si hoy no se ve, el foco depende del primer evento, así que la clave cambia
 * también cuando llegan los eventos (antes se quedaba en las 08:00).
 */
export function calendarFocusKey(
  view: AgendaView,
  days: readonly string[],
  focusToken: number,
  todayVisible: boolean,
  hasVisibleEvents: boolean,
): string {
  const target = todayVisible ? 'now' : hasVisibleEvents ? 'events' : 'empty';
  return `${view}|${days.join(',')}|${focusToken}|${target}`;
}

/** Franja horaria visible: la de por defecto, ampliada para que quepa todo. */
export function hourRangeFor(
  events: readonly SchedulingEvent[],
  windows: readonly { start: string; end: string }[] = [],
): HourRange {
  let start = DEFAULT_HOUR_RANGE.start;
  let end = DEFAULT_HOUR_RANGE.end;
  for (const w of windows) {
    const s = minutesOf(w.start);
    const e = minutesOf(w.end) > s ? minutesOf(w.end) : 24 * 60;
    start = Math.min(start, Math.floor(s / 60) * 60);
    end = Math.max(end, Math.ceil(e / 60) * 60);
  }
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
  /** Empezó el día anterior (se pinta desde las 00:00). */
  continued: boolean;
  /** Sigue al día siguiente (se corta a las 24:00). */
  continues: boolean;
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
  /** Día de la columna: un evento de un día anterior empieza a las 00:00. */
  day?: string,
): PlacedEvent[] {
  const span = range.end - range.start;
  const items = events
    .map((event) => {
      const column = day ?? event.date;
      const continued = event.date < column;
      const continues = event.end_date > column;
      const start = continued ? 0 : minutesOf(event.local_start);
      const rawEnd = continues ? 24 * 60 : minutesOf(event.local_end);
      const end = Math.max(rawEnd, start + minHeightMinutes);
      return { event, start, end, continued, continues };
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
        continued: g.item.continued,
        continues: g.item.continues,
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

/** Disponibilidad combinada de los prestadores filtrados en un día. */
export interface DayAvailability {
  /** Franjas donde al menos un prestador filtrado atiende (unidas, en minutos). */
  windows: { start: number; end: number }[];
  /** Todos los prestadores filtrados tienen el día bloqueado por excepción. */
  blocked: boolean;
  /** Motivos de las excepciones del día (sin repetir). */
  reasons: string[];
}

/**
 * Une la disponibilidad de los prestadores filtrados por día. Un día sin
 * franjas y sin bloqueo es un día en que no trabajan.
 */
export function availabilityByDay(
  rows: readonly ProviderDayAvailability[],
): Map<string, DayAvailability> {
  const grouped = new Map<string, ProviderDayAvailability[]>();
  for (const row of rows) {
    const list = grouped.get(row.date) ?? [];
    list.push(row);
    grouped.set(row.date, list);
  }
  const out = new Map<string, DayAvailability>();
  for (const [date, list] of grouped) {
    const spans = list
      .flatMap((r) => r.windows)
      .map((w) => {
        const start = minutesOf(w.start);
        const end = minutesOf(w.end);
        return { start, end: end > start ? end : 24 * 60 };
      })
      .sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
      else merged.push({ ...span });
    }
    out.set(date, {
      windows: merged,
      blocked: list.every((r) => r.unavailable),
      reasons: [...new Set(list.map((r) => r.reason).filter((r): r is string => !!r))],
    });
  }
  return out;
}

/** Tramos fuera de la disponibilidad dentro de la franja visible, en %. */
export function offHourBands(
  day: DayAvailability | undefined,
  range: HourRange,
): { top: number; height: number }[] {
  if (!day) return [];
  const span = range.end - range.start;
  const bands: { top: number; height: number }[] = [];
  let cursor = range.start;
  for (const w of day.windows) {
    const start = Math.max(w.start, range.start);
    const end = Math.min(w.end, range.end);
    if (end <= start) continue;
    if (start > cursor) bands.push({ top: ((cursor - range.start) / span) * 100, height: ((start - cursor) / span) * 100 });
    cursor = Math.max(cursor, end);
  }
  if (cursor < range.end) {
    bands.push({ top: ((cursor - range.start) / span) * 100, height: ((range.end - cursor) / span) * 100 });
  }
  return bands;
}

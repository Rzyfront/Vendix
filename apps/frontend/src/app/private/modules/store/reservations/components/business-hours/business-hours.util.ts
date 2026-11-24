import { BusinessHoursRow } from '../../interfaces/reservation.interface';
import {
  ClockWindow,
  isClockTime,
  isOvernight,
  validateWeeklyBlocks,
} from '../../../../../../shared/utils/schedule-window.util';

/** Max blocks per day, same as Settings → Sales (custom mode). */
export const MAX_BLOCKS_PER_DAY = 5;

export const FULL_DAY_BLOCK: ClockWindow = { start_time: '00:00', end_time: '00:00' };

export const DAY_LABELS: Array<{ dow: number; label: string }> = [
  { dow: 1, label: 'Lunes' },
  { dow: 2, label: 'Martes' },
  { dow: 3, label: 'Miércoles' },
  { dow: 4, label: 'Jueves' },
  { dow: 5, label: 'Viernes' },
  { dow: 6, label: 'Sábado' },
  { dow: 0, label: 'Domingo' },
];

/** Editable state of one day of the store schedule. */
export interface BusinessHoursDay {
  day_of_week: number;
  is_active: boolean;
  is_24h: boolean;
  blocks: ClockWindow[];
}

export function dayLabel(dow: number): string {
  return DAY_LABELS.find((d) => d.dow === dow)?.label ?? `Día ${dow}`;
}

/** True when the block is the explicit "open 24 hours" `00:00-00:00`. */
export function isFullDayBlock(b: ClockWindow): boolean {
  return b.start_time === '00:00' && b.end_time === '00:00';
}

/** True when the block closes the next day (e.g. 17:00–04:00). */
export function endsNextDay(b: ClockWindow): boolean {
  return isClockTime(b.start_time) && isClockTime(b.end_time) && !isFullDayBlock(b) && isOvernight(b);
}

/** API rows → 7 editable days (closed days keep a 09:00–18:00 draft block). */
export function daysFromRows(rows: BusinessHoursRow[]): BusinessHoursDay[] {
  const out: BusinessHoursDay[] = [];
  for (let dow = 0; dow <= 6; dow++) {
    const row = rows.find((r) => r.day_of_week === dow);
    const blocks: ClockWindow[] = row?.blocks?.length
      ? row.blocks.map((b) => ({ start_time: b.start_time, end_time: b.end_time }))
      : row?.start_time && row?.end_time
        ? [{ start_time: row.start_time, end_time: row.end_time }]
        : [];
    const is24h = blocks.length === 1 && isFullDayBlock(blocks[0]);
    out.push({
      day_of_week: dow,
      is_active: !!row?.is_active && blocks.length > 0,
      is_24h: is24h,
      blocks: blocks.length && !is24h ? blocks : [{ start_time: '09:00', end_time: '18:00' }],
    });
  }
  return out;
}

/** Blocks the day really saves: `00:00-00:00` when 24 h. */
export function effectiveBlocks(day: BusinessHoursDay): ClockWindow[] {
  return day.is_24h ? [FULL_DAY_BLOCK] : day.blocks;
}

/**
 * First problem of the week in the user's words, or null. Same rules as the
 * API: HH:mm, no zero-length block except 24 h, no overlap (including the
 * previous day's overnight spill).
 */
export function validateDays(days: BusinessHoursDay[]): string | null {
  const active = days.filter((d) => d.is_active);
  if (active.length === 0) return 'Debes abrir al menos un día';
  for (const d of active) {
    if (effectiveBlocks(d).some((b) => b.start_time === b.end_time && !isFullDayBlock(b))) {
      return `${dayLabel(d.day_of_week)}: la apertura y el cierre son la misma hora. Usa «24 horas» para abrir todo el día`;
    }
  }
  const problem = validateWeeklyBlocks(
    active.flatMap((d) =>
      effectiveBlocks(d).map((b) => ({ day: d.day_of_week, start_time: b.start_time, end_time: b.end_time })),
    ),
  );
  if (problem) {
    const label = dayLabel(problem.day);
    return problem.reason === 'format'
      ? `${label}: usa horas válidas (HH:mm)`
      : `${label}: los bloques se cruzan entre sí o con el cierre de madrugada del día anterior`;
  }
  return null;
}

/** Editable days → `PUT /store/business-hours` items (all 7 days). */
export function toPayload(days: BusinessHoursDay[]): BusinessHoursRow[] {
  return days.map((d) => {
    const blocks = effectiveBlocks(d);
    return {
      day_of_week: d.day_of_week,
      start_time: blocks[0].start_time,
      end_time: blocks[blocks.length - 1].end_time,
      is_active: d.is_active,
      ...(d.is_active && blocks.length > 1 ? { blocks } : {}),
    };
  });
}

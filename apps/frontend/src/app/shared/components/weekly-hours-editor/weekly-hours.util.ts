/**
 * One weekly schedule, edited the same way everywhere: Agenda → Configuración →
 * Horario de la tienda, Ajustes → Venta and a provider's own schedule.
 *
 * Contract (same as the API, see `schedule-window.util`):
 *  - A block is `{ start_time, end_time }` in `HH:mm`.
 *  - `end <= start` ends the NEXT day (17:00–04:00). `00:00–00:00` is 24 hours.
 *  - A block belongs to the day it starts.
 *
 * Pure functions only: no Angular, no timezone math.
 */
import {
  ClockWindow,
  isClockTime,
  isOvernight,
  toMinutes,
  windowMinutes,
  windowSpan,
} from '../../utils/schedule-window.util';

export const MAX_BLOCKS_PER_DAY = 5;
export const FULL_DAY_BLOCK: ClockWindow = { start_time: '00:00', end_time: '00:00' };
const DAY_MIN = 1440;
const WEEK_MIN = DAY_MIN * 7;

/** Editable state of one day. */
export interface WeekHoursDay {
  day_of_week: number; // 0 = Sunday … 6 = Saturday
  is_active: boolean;
  is_24h: boolean;
  /** Draft blocks; kept while the day is closed or 24 h so toggling back restores them. */
  blocks: ClockWindow[];
}

export interface WeekDayLabel {
  dow: number;
  label: string;
  short: string;
}

/** Monday first, like the rest of the admin. */
export const WEEK_DAYS: WeekDayLabel[] = [
  { dow: 1, label: 'Lunes', short: 'Lun' },
  { dow: 2, label: 'Martes', short: 'Mar' },
  { dow: 3, label: 'Miércoles', short: 'Mié' },
  { dow: 4, label: 'Jueves', short: 'Jue' },
  { dow: 5, label: 'Viernes', short: 'Vie' },
  { dow: 6, label: 'Sábado', short: 'Sáb' },
  { dow: 0, label: 'Domingo', short: 'Dom' },
];

const DEFAULT_DRAFT: ClockWindow = { start_time: '09:00', end_time: '18:00' };

export function dayLabel(dow: number): string {
  return WEEK_DAYS.find((d) => d.dow === dow)?.label ?? `Día ${dow}`;
}

export function dayShort(dow: number): string {
  return WEEK_DAYS.find((d) => d.dow === dow)?.short ?? `${dow}`;
}

export function isFullDayBlock(b: ClockWindow): boolean {
  return b.start_time === '00:00' && b.end_time === '00:00';
}

/** True when the block closes the next day (17:00–04:00); 24 h is not a night shift. */
export function endsNextDay(b: ClockWindow): boolean {
  return isClockTime(b.start_time) && isClockTime(b.end_time) && !isFullDayBlock(b) && isOvernight(b);
}

/** Blocks the day really has (none when closed, `00:00–00:00` when 24 h), sorted by start. */
export function effectiveBlocks(day: WeekHoursDay): ClockWindow[] {
  if (!day.is_active) return [];
  if (day.is_24h) return [FULL_DAY_BLOCK];
  return [...day.blocks].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
}

/** `24:00` (legacy POS value) is midnight. */
function normalizeTime(value: unknown): string | null {
  const v = value === '24:00' ? '00:00' : value;
  return isClockTime(v) ? v : null;
}

/** Valid blocks of one day → editable day (sorted, Monday-first order is kept by the caller). */
export function dayFromBlocks(dow: number, raw: ClockWindow[], isActive = true): WeekHoursDay {
  const blocks = raw
    .map((b) => {
      const start = normalizeTime(b.start_time);
      const end = normalizeTime(b.end_time);
      return start && end ? { start_time: start, end_time: end } : null;
    })
    .filter((b): b is ClockWindow => !!b)
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const is24h = blocks.length === 1 && isFullDayBlock(blocks[0]);
  return {
    day_of_week: dow,
    is_active: isActive && blocks.length > 0,
    is_24h: is24h,
    blocks: blocks.length && !is24h ? blocks : [{ ...DEFAULT_DRAFT }],
  };
}

/** Week in Monday-first order with every day present. */
export function normalizeWeek(days: WeekHoursDay[]): WeekHoursDay[] {
  return WEEK_DAYS.map(
    (w) => days.find((d) => d.day_of_week === w.dow) ?? dayFromBlocks(w.dow, [], false),
  );
}

// ─── Adapters ────────────────────────────────────────────────────────────

/** Rows of `GET /store/business-hours` (one per day, optional `blocks`). */
export interface StoreHoursRowLike {
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean;
  blocks?: ClockWindow[];
}

export function weekFromStoreRows(rows: StoreHoursRowLike[]): WeekHoursDay[] {
  return WEEK_DAYS.map((w) => {
    const row = rows.find((r) => r.day_of_week === w.dow);
    const blocks: ClockWindow[] = row?.blocks?.length
      ? row.blocks
      : row?.start_time && row?.end_time
        ? [{ start_time: row.start_time, end_time: row.end_time }]
        : [];
    return dayFromBlocks(w.dow, blocks, !!row?.is_active);
  });
}

/** Week → `PUT /store/business-hours` items (all 7 days, same shape as before). */
export function weekToStoreRows(days: WeekHoursDay[]): StoreHoursRowLike[] {
  return normalizeWeek(days).map((d) => {
    const blocks = d.is_active ? effectiveBlocks(d) : d.is_24h ? [FULL_DAY_BLOCK] : d.blocks;
    return {
      day_of_week: d.day_of_week,
      start_time: blocks[0].start_time,
      end_time: blocks[blocks.length - 1].end_time,
      is_active: d.is_active,
      ...(d.is_active && blocks.length > 1 ? { blocks } : {}),
    };
  });
}

/** One row per block (provider / station schedules). */
export interface WeeklyRowLike {
  day_of_week: number;
  start_time: string;
  end_time: string;
  block_order?: number;
}

export function weekFromBlockRows(rows: WeeklyRowLike[]): WeekHoursDay[] {
  return WEEK_DAYS.map((w) => {
    const own = rows
      .filter((r) => r.day_of_week === w.dow)
      .sort((a, b) => (a.block_order ?? 0) - (b.block_order ?? 0));
    return dayFromBlocks(w.dow, own);
  });
}

/** Week → one item per open block, `block_order` by start time. */
export function weekToBlockRows(
  days: WeekHoursDay[],
): Array<{ day_of_week: number; block_order: number; is_active: true; start_time: string; end_time: string }> {
  return normalizeWeek(days).flatMap((d) =>
    effectiveBlocks(d).map((b, i) => ({
      day_of_week: d.day_of_week,
      block_order: i,
      is_active: true as const,
      start_time: b.start_time,
      end_time: b.end_time,
    })),
  );
}

/** `settings.pos.business_hours` (Ajustes → Venta). */
export type PosHoursMode = 'continuous' | 'custom';
export interface PosDayHours {
  open: string;
  close: string;
  blocks?: Array<{ open: string; close: string }>;
  is_active?: boolean;
}
const POS_KEYS: Record<number, string> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

/**
 * Same reading as the API (`loadStoreWindowsFromPosSettings`): `blocks` when it
 * has any, else `open`/`close`; `closed` or invalid → closed. In custom mode an
 * empty `blocks` list is closed on both sides (that is how the old Venta screen
 * closed a day).
 */
export function weekFromPosHours(
  hours: Record<string, PosDayHours | string | null | undefined> | null | undefined,
  mode: PosHoursMode | null | undefined,
): WeekHoursDay[] {
  return WEEK_DAYS.map((w) => {
    const value = hours?.[POS_KEYS[w.dow]];
    if (!value || typeof value === 'string' || value.is_active === false) {
      return dayFromBlocks(w.dow, [], false);
    }
    if (Array.isArray(value.blocks) && value.blocks.length) {
      return dayFromBlocks(
        w.dow,
        value.blocks.map((b) => ({ start_time: b.open, end_time: b.close })),
      );
    }
    if (mode === 'custom' && Array.isArray(value.blocks)) {
      const draft = dayFromBlocks(w.dow, [{ start_time: value.open, end_time: value.close }]);
      return { ...draft, is_active: false };
    }
    return dayFromBlocks(w.dow, [{ start_time: value.open, end_time: value.close }]);
  });
}

/**
 * Week → `pos.business_hours` + `schedule_mode`, mirroring the API writer
 * (`BusinessHoursService.upsert`): custom when it already was or a day has
 * several blocks; closed days are written `closed` explicitly.
 */
export function weekToPosHours(
  days: WeekHoursDay[],
  currentMode: PosHoursMode | null | undefined,
): { business_hours: Record<string, PosDayHours>; schedule_mode: PosHoursMode } {
  const week = normalizeWeek(days);
  const custom = currentMode === 'custom' || week.some((d) => effectiveBlocks(d).length > 1);
  const out: Record<string, PosDayHours> = {};
  for (const d of week) {
    const key = POS_KEYS[d.day_of_week];
    const blocks = effectiveBlocks(d);
    if (!blocks.length) {
      out[key] = custom ? { open: 'closed', close: 'closed', blocks: [] } : { open: 'closed', close: 'closed' };
      continue;
    }
    const open = blocks[0].start_time;
    const close = blocks[blocks.length - 1].end_time;
    out[key] = custom
      ? { open, close, blocks: blocks.map((b) => ({ open: b.start_time, close: b.end_time })) }
      : { open, close };
  }
  return { business_hours: out, schedule_mode: custom ? 'custom' : (currentMode ?? 'continuous') };
}

// ─── Validation (inline, per block) ──────────────────────────────────────

export interface WeekIssues {
  /** `${dow}:${blockIndex}` → message shown next to the block. */
  blocks: Record<string, string>;
  /** Day-level message (e.g. the previous night shift runs into this day). */
  days: Record<number, string>;
  /** Week-level message (e.g. every day closed). */
  week: string | null;
  count: number;
}

export function blockKey(dow: number, index: number): string {
  return `${dow}:${index}`;
}

/**
 * Problems in the operator's words, located on the block. Rules match the API:
 * valid hours, no zero-length block except «24 horas», no overlap inside the
 * day nor with the previous day's night shift (Saturday's runs into Sunday).
 */
export function validateWeek(days: WeekHoursDay[], opts: { requireOpenDay?: boolean } = {}): WeekIssues {
  const issues: WeekIssues = { blocks: {}, days: {}, week: null, count: 0 };
  const week = normalizeWeek(days);
  const add = (key: string, msg: string) => {
    if (!issues.blocks[key]) {
      issues.blocks[key] = msg;
      issues.count++;
    }
  };

  interface Placed { dow: number; index: number; start: number; end: number }
  const placed: Placed[] = [];
  for (const d of week) {
    if (!d.is_active || d.is_24h) {
      if (d.is_active) placed.push({ dow: d.day_of_week, index: -1, start: d.day_of_week * DAY_MIN, end: d.day_of_week * DAY_MIN + DAY_MIN });
      continue;
    }
    d.blocks.forEach((b, index) => {
      const key = blockKey(d.day_of_week, index);
      if (!isClockTime(b.start_time) || !isClockTime(b.end_time)) {
        add(key, 'Elige una hora de apertura y una de cierre');
        return;
      }
      if (b.start_time === b.end_time) {
        add(key, 'La apertura y el cierre son la misma hora. Para abrir todo el día usa «24 horas»');
        return;
      }
      const span = windowSpan(b);
      placed.push({ dow: d.day_of_week, index, start: d.day_of_week * DAY_MIN + span.startMin, end: d.day_of_week * DAY_MIN + span.endMin });
    });
  }

  const overlaps = (a: Placed, b: Placed) =>
    [0, WEEK_MIN, -WEEK_MIN].some((shift) => a.start < b.end + shift && a.end > b.start + shift);

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (!overlaps(a, b)) continue;
      if (a.dow === b.dow) {
        if (a.index >= 0) add(blockKey(a.dow, a.index), 'Se cruza con otro tramo del mismo día');
        if (b.index >= 0) add(blockKey(b.dow, b.index), 'Se cruza con otro tramo del mismo día');
        continue;
      }
      // Different days: the earlier one spills over the next day.
      const [spill, hit] = (b.dow - a.dow + 7) % 7 === 1 ? [a, b] : [b, a];
      const msg = `Se cruza con el turno del ${dayLabel(spill.dow).toLowerCase()}, que termina este día`;
      if (hit.index >= 0) add(blockKey(hit.dow, hit.index), msg);
      else if (!issues.days[hit.dow]) {
        issues.days[hit.dow] = msg;
        issues.count++;
      }
    }
  }

  if (opts.requireOpenDay && !week.some((d) => d.is_active)) {
    issues.week = 'Abre al menos un día para poder recibir reservas';
    issues.count++;
  }
  return issues;
}

// ─── Display ─────────────────────────────────────────────────────────────

/** `17:30` → `5:30 p. m.`; `00:00` → `12:00 a. m.` (12 h like the rest of the app). */
export function formatTime12(hhmm: string): string {
  if (!isClockTime(hhmm)) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'a. m.' : 'p. m.';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Compact form for summaries: `8 a. m.`, `5:30 p. m.`. */
export function formatTimeShort(hhmm: string): string {
  if (!isClockTime(hhmm)) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'a. m.' : 'p. m.';
  return m === 0 ? `${h % 12 || 12} ${suffix}` : `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function blockText(b: ClockWindow, short = false): string {
  const f = short ? formatTimeShort : formatTime12;
  return `${f(b.start_time)} – ${f(b.end_time)}${endsNextDay(b) ? ' (día siguiente)' : ''}`;
}

/** What one day says in plain words: `Cerrado`, `24 horas`, `8 a. m. – 6 p. m.`. */
export function dayText(day: WeekHoursDay, short = true): string {
  if (!day.is_active) return 'Cerrado';
  if (day.is_24h) return '24 horas';
  return effectiveBlocks(day)
    .map((b) => blockText(b, short))
    .join(' y ');
}

/**
 * The week in one line: «Abierto todos los días, 24 horas», or consecutive days
 * with the same hours grouped: «Lun–Vie 8 a. m. – 6 p. m. · Sáb 9 a. m. – 1 p. m. · Dom cerrado».
 */
export function summarizeWeek(days: WeekHoursDay[]): string {
  const week = normalizeWeek(days);
  if (!week.some((d) => d.is_active)) return 'Cerrado todos los días';
  const texts = week.map((d) => dayText(d));
  if (texts.every((t) => t === texts[0])) {
    return texts[0] === '24 horas' ? 'Abierto todos los días, 24 horas' : `Todos los días ${texts[0]}`;
  }
  const groups: Array<{ from: number; to: number; text: string }> = [];
  week.forEach((d, i) => {
    const last = groups[groups.length - 1];
    if (last && last.text === texts[i]) last.to = i;
    else groups.push({ from: i, to: i, text: texts[i] });
  });
  return groups
    .map((g) => {
      const from = WEEK_DAYS[g.from].short;
      const to = WEEK_DAYS[g.to].short;
      const range = g.from === g.to ? from : g.to - g.from === 1 ? `${from} y ${to}` : `${from}–${to}`;
      return `${range} ${g.text === 'Cerrado' ? 'cerrado' : g.text}`;
    })
    .join(' · ');
}

export function openDaysCount(days: WeekHoursDay[]): number {
  return days.filter((d) => d.is_active).length;
}

export function weeklyHours(days: WeekHoursDay[]): number {
  const minutes = days.reduce(
    (sum, d) => sum + effectiveBlocks(d).reduce((s, b) => s + windowMinutes(b), 0),
    0,
  );
  return Math.round(minutes / 60);
}

/** Painted segment of the 0–24 h bar of one day, in percent. */
export interface DaySegment {
  left: number;
  width: number;
  /** `spill`: the previous day's night shift running into this day. */
  kind: 'open' | 'spill';
  /** The block keeps going after midnight (drawn with an open right edge). */
  continues: boolean;
  label: string;
}

export function daySegments(days: WeekHoursDay[], dow: number): DaySegment[] {
  const week = normalizeWeek(days);
  const pct = (min: number) => (min / DAY_MIN) * 100;
  const out: DaySegment[] = [];
  const prev = week.find((d) => d.day_of_week === (dow + 6) % 7)!;
  for (const b of effectiveBlocks(prev)) {
    if (!isClockTime(b.start_time) || !isClockTime(b.end_time) || isFullDayBlock(b)) continue;
    const span = windowSpan(b);
    if (span.endMin > DAY_MIN) {
      out.push({
        left: 0,
        width: pct(span.endMin - DAY_MIN),
        kind: 'spill',
        continues: false,
        label: `Turno del ${dayLabel(prev.day_of_week).toLowerCase()} hasta ${formatTime12(b.end_time)}`,
      });
    }
  }
  const day = week.find((d) => d.day_of_week === dow)!;
  for (const b of effectiveBlocks(day)) {
    if (!isClockTime(b.start_time) || !isClockTime(b.end_time)) continue;
    if (isFullDayBlock(b)) {
      out.push({ left: 0, width: 100, kind: 'open', continues: false, label: 'Abierto 24 horas' });
      continue;
    }
    if (b.start_time === b.end_time) continue;
    const span = windowSpan(b);
    const end = Math.min(span.endMin, DAY_MIN);
    out.push({
      left: pct(span.startMin),
      width: pct(end - span.startMin),
      kind: 'open',
      continues: span.endMin > DAY_MIN,
      label: blockText(b),
    });
  }
  return out;
}

// ─── Editing helpers ─────────────────────────────────────────────────────

export type WeekPreset = 'always' | 'weekdays' | 'night';

export const WEEK_PRESETS: Array<{ id: WeekPreset; label: string; hint: string; icon: string }> = [
  { id: 'always', label: '24/7', hint: 'Abierto todos los días, las 24 horas', icon: 'clock' },
  { id: 'weekdays', label: 'Lun–Vie 8 a. m. – 6 p. m.', hint: 'Lunes a viernes de 8 a. m. a 6 p. m.; sábado y domingo cerrado', icon: 'briefcase' },
  { id: 'night', label: 'Nocturno 5 p. m. – 4 a. m.', hint: 'Todos los días de 5 p. m. a 4 a. m. del día siguiente', icon: 'moon' },
];

export function applyPreset(days: WeekHoursDay[], preset: WeekPreset): WeekHoursDay[] {
  return normalizeWeek(days).map((d) => {
    if (preset === 'always') return { ...d, is_active: true, is_24h: true };
    if (preset === 'night') {
      return { ...d, is_active: true, is_24h: false, blocks: [{ start_time: '17:00', end_time: '04:00' }] };
    }
    const weekday = d.day_of_week >= 1 && d.day_of_week <= 5;
    return { ...d, is_active: weekday, is_24h: false, blocks: [{ start_time: '08:00', end_time: '18:00' }] };
  });
}

export type CopyTarget = 'all' | 'weekdays' | 'weekend';

export const COPY_TARGETS: Array<{ id: CopyTarget; label: string }> = [
  { id: 'all', label: 'Todos los días' },
  { id: 'weekdays', label: 'Lunes a viernes' },
  { id: 'weekend', label: 'Sábado y domingo' },
];

/** Copies one day (open/closed, 24 h and blocks) to the target days. */
export function copyDay(days: WeekHoursDay[], fromDow: number, target: CopyTarget): WeekHoursDay[] {
  const week = normalizeWeek(days);
  const source = week.find((d) => d.day_of_week === fromDow)!;
  const hit = (dow: number) =>
    target === 'all' || (target === 'weekdays' ? dow >= 1 && dow <= 5 : dow === 0 || dow === 6);
  return week.map((d) =>
    d.day_of_week !== fromDow && hit(d.day_of_week)
      ? { ...d, is_active: source.is_active, is_24h: source.is_24h, blocks: source.blocks.map((b) => ({ ...b })) }
      : d,
  );
}

/** Next block: one hour after the last close, two hours long (capped to the day). */
export function nextBlock(day: WeekHoursDay): ClockWindow {
  const last = day.blocks[day.blocks.length - 1];
  const lastEnd = last && isClockTime(last.end_time) && !endsNextDay(last) ? toMinutes(last.end_time) : 12 * 60;
  const start = Math.min(lastEnd + 60, 22 * 60);
  const end = Math.min(start + 120, 23 * 60 + 45);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { start_time: hhmm(start), end_time: hhmm(end) };
}

/** Options of the hour selectors: every 15 minutes, plus the current value if it is off-grid. */
export function timeOptions(current?: string): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (let m = 0; m < DAY_MIN; m += 15) {
    const value = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    out.push({ value, label: formatTime12(value) });
  }
  if (current && isClockTime(current) && !out.some((o) => o.value === current)) {
    out.push({ value: current, label: formatTime12(current) });
    out.sort((a, b) => toMinutes(a.value) - toMinutes(b.value));
  }
  return out;
}

export function sameWeek(a: WeekHoursDay[], b: WeekHoursDay[]): boolean {
  const sig = (days: WeekHoursDay[]) =>
    normalizeWeek(days)
      .map((d) => `${d.day_of_week}:${effectiveBlocks(d).map((x) => `${x.start_time}-${x.end_time}`).join(',')}`)
      .join('|');
  return sig(a) === sig(b);
}

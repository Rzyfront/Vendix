/** Live clock helpers for stations and sessions. Pure functions, no Angular or zone APIs. */

export type StationClockMode = 'elapsed' | 'countdown' | 'overtime';

export interface StationClock {
  mode: StationClockMode;
  /** Ready to render: "01:23:10 ↑", "00:35:00 ↓" or "+00:12:40". */
  text: string;
}

/** Next booking that starts on the same station after the current session. */
export interface NextReservation {
  start_at: string;
  booking_id?: number | null;
  customer_name?: string | null;
}

/** Minutes before the planned end within which a next booking raises a warning. */
export const NEXT_RESERVATION_WARNING_MINUTES = 30;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats a non-negative duration in milliseconds as HH:MM:SS (hours can exceed 24). */
export function formatClockDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * No planned end: elapsed since opening (up arrow). Planned end in the future:
 * countdown (down arrow). Past the planned end: "+HH:MM:SS" that keeps counting.
 * Returns null when the opening time is unusable.
 */
export function computeStationClock(
  openedAt: string | null | undefined,
  plannedEndAt: string | null | undefined,
  nowMs: number,
): StationClock | null {
  const opened = openedAt ? new Date(openedAt).getTime() : NaN;
  if (!Number.isFinite(opened)) return null;
  const planned = plannedEndAt ? new Date(plannedEndAt).getTime() : NaN;
  if (!Number.isFinite(planned)) {
    return { mode: 'elapsed', text: `${formatClockDuration(nowMs - opened)} ↑` };
  }
  if (planned > nowMs) {
    return { mode: 'countdown', text: `${formatClockDuration(planned - nowMs)} ↓` };
  }
  return { mode: 'overtime', text: `+${formatClockDuration(nowMs - planned)}` };
}

/**
 * True when there is a next booking and the session is already overtime or will
 * end within 30 minutes of that booking start (or after it).
 */
export function shouldWarnNextReservation(
  plannedEndAt: string | null | undefined,
  next: NextReservation | null | undefined,
  nowMs: number,
): boolean {
  if (!next?.start_at) return false;
  const start = new Date(next.start_at).getTime();
  if (!Number.isFinite(start)) return false;
  const planned = plannedEndAt ? new Date(plannedEndAt).getTime() : NaN;
  // Without a planned end the session can run into the booking at any time.
  if (!Number.isFinite(planned)) return start - nowMs <= NEXT_RESERVATION_WARNING_MINUTES * 60_000;
  if (planned <= nowMs) return true;
  return planned >= start - NEXT_RESERVATION_WARNING_MINUTES * 60_000;
}

/** "Próxima reserva 02:00" in the store time zone. */
export function nextReservationLabel(next: NextReservation, timeZone: string | null | undefined): string {
  const date = new Date(next.start_at);
  if (!Number.isFinite(date.getTime())) return 'Próxima reserva';
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  let time: string;
  try {
    time = new Intl.DateTimeFormat('es-CO', { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch {
    time = new Intl.DateTimeFormat('es-CO', options).format(date);
  }
  return `Próxima reserva ${time}`;
}

/** New planned end: later of (current planned end, now) plus the given minutes, as UTC ISO. */
export function addMinutesIso(baseIso: string | null | undefined, minutes: number, nowMs: number): string {
  const base = baseIso ? new Date(baseIso).getTime() : NaN;
  // Extend from the later of the current planned end and now, so an overtime session gains real time.
  const from = Number.isFinite(base) ? Math.max(base, nowMs) : nowMs;
  return new Date(from + minutes * 60_000).toISOString();
}

/** Formats an instant as a datetime-local value (YYYY-MM-DDTHH:mm) in the given IANA time zone. */
export function isoToStoreLocalInput(iso: string, timeZone: string | null | undefined): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}`;
}

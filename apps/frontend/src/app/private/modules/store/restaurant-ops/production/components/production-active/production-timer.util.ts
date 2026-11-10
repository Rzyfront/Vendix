/**
 * Stopwatch maths of Producción activa (QUI-1002). Pure functions so the
 * component only feeds them the shared 1 s ticker value.
 */

export interface ProductionTimerView {
  /** `down` = counting toward the estimate; `exceeded` = past it; `up` = no estimate. */
  mode: 'down' | 'exceeded' | 'up';
  /** Clock text: `mm:ss` or `h:mm:ss`. */
  text: string;
  /** Short caption for the clock. */
  caption: string;
}

/** `mm:ss` below one hour, `h:mm:ss` from one hour on. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * Timer of one in-progress order, computed from the saved `started_at` with
 * the client clock, so a reload or another device shows the same value.
 * Returns null when there is no start time to count from.
 */
export function buildTimerView(
  startedAt: string | null,
  estimatedMinutes: number | null,
  nowMs: number,
): ProductionTimerView | null {
  if (!startedAt) return null;
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs)) return null;
  const elapsed = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  if (estimatedMinutes == null) {
    return { mode: 'up', text: formatClock(elapsed), caption: 'Transcurrido' };
  }
  const remaining = estimatedMinutes * 60 - elapsed;
  if (remaining >= 0) {
    return { mode: 'down', text: formatClock(remaining), caption: 'Restante' };
  }
  return {
    mode: 'exceeded',
    text: `+${formatClock(-remaining)}`,
    caption: 'Tiempo excedido',
  };
}

/** `45 min` / `1 h 30 min` for an estimate in minutes. */
export function formatEstimate(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

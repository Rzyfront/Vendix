const MS_PER_DAY = 86_400_000;

/** Calendar-day difference in UTC. Mirrors the original private helper in membership-detail-page. */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS_PER_DAY);
}

export interface MembershipProgress {
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  percent: number;
  hasRange: boolean;
}

/** Elapsed-time percent for a membership period. Returns hasRange=false when dates missing/invalid. */
export function membershipProgress(
  period_start?: string | null,
  period_end?: string | null,
): MembershipProgress {
  const empty: MembershipProgress = {
    totalDays: 0,
    elapsedDays: 0,
    remainingDays: 0,
    percent: 0,
    hasRange: false,
  };
  if (!period_start || !period_end) return empty;
  const start = new Date(period_start);
  const end = new Date(period_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return empty;
  const totalDays = Math.max(calendarDaysBetween(start, end), 0);
  const rawElapsed = calendarDaysBetween(start, new Date());
  const elapsedDays = Math.min(Math.max(rawElapsed, 0), totalDays);
  const remainingDays = totalDays - elapsedDays;
  const percent =
    totalDays > 0 ? Math.min(Math.round((elapsedDays / totalDays) * 100), 100) : 0;
  return { totalDays, elapsedDays, remainingDays, percent, hasRange: true };
}
import type { Reminder } from '../../services/reminders.service';

/** Visual urgency of a dated reminder: far away, close, or already due. */
export type ReminderTimeTone = 'far' | 'near' | 'overdue';

export interface ReminderProgress {
  /** Share of the time between creation and due date already elapsed (0-100). */
  percent: number;
  tone: ReminderTimeTone;
  /** Human remaining time, e.g. "Faltan 2 días" or "Venció hace 3 h". */
  label: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A reminder is "near" once 75 % of its time elapsed or less than a day is left. */
const NEAR_PERCENT = 75;

function instant(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  return new Date(iso).getTime();
}

function plural(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/** "2 días", "3 h", "15 min" for a positive span of time. */
export function formatSpan(ms: number): string {
  if (ms >= DAY_MS) return plural(Math.floor(ms / DAY_MS), 'día', 'días');
  if (ms >= HOUR_MS) return `${Math.floor(ms / HOUR_MS)} h`;
  return `${Math.max(1, Math.floor(ms / MINUTE_MS))} min`;
}

/**
 * Time bar of a reminder: it fills from its creation up to its due date.
 * Done reminders and reminders without a date have no bar (`null`).
 */
export function reminderProgress(item: Reminder, now: number): ReminderProgress | null {
  if (item.status === 'done') return null;
  const due = instant(item.remind_at);
  if (Number.isNaN(due)) return null;

  const remaining = due - now;
  if (remaining <= 0) {
    return { percent: 100, tone: 'overdue', label: `Venció hace ${formatSpan(-remaining || 1)}` };
  }

  const created = instant(item.created_at);
  const total = due - created;
  const elapsed = now - created;
  const percent =
    Number.isNaN(created) || total <= 0
      ? 0
      : Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  const tone: ReminderTimeTone =
    percent >= NEAR_PERCENT || remaining < DAY_MS ? 'near' : 'far';
  return { percent, tone, label: `Faltan ${formatSpan(remaining)}` };
}

/**
 * Order of the dashboard Bitácora: pending reminders from the soonest due date
 * to the latest (overdue ones come first because their date already passed),
 * then pending ones without a date, then done ones (latest completed first).
 */
export function sortReminders(items: readonly Reminder[]): Reminder[] {
  const rank = (item: Reminder): number => {
    if (item.status === 'done') return 2;
    return Number.isNaN(instant(item.remind_at)) ? 1 : 0;
  };
  return [...items].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (rank(a) === 0) {
      return instant(a.remind_at) - instant(b.remind_at) || a.id - b.id;
    }
    if (rank(a) === 2) {
      const doneA = instant(a.completed_at ?? a.updated_at) || 0;
      const doneB = instant(b.completed_at ?? b.updated_at) || 0;
      return doneB - doneA || b.id - a.id;
    }
    return instant(b.created_at) - instant(a.created_at) || b.id - a.id;
  });
}

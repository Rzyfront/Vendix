import type { Reminder } from '../../dashboard/services/reminders.service';
import type { VexConversation } from '../models/vex.models';

/**
 * Filters of the Vex "Bitácora empresarial" sidebar. They mirror the buckets
 * the dashboard Bitácora groups by (`GROUP_ORDER` in `reminders-log`), so both
 * views read the same reminders the same way.
 */
export type VexReminderFilter = 'pending' | 'today' | 'overdue' | 'upcoming' | 'done';

export interface VexReminderFilterMeta {
  key: VexReminderFilter;
  label: string;
  icon: string;
}

export const VEX_REMINDER_FILTERS: readonly VexReminderFilterMeta[] = [
  { key: 'pending', label: 'Pendientes', icon: 'list' },
  { key: 'today', label: 'Hoy', icon: 'calendar' },
  { key: 'overdue', label: 'Vencidos', icon: 'alert-circle' },
  { key: 'upcoming', label: 'Próximos', icon: 'clock' },
  { key: 'done', label: 'Hechos', icon: 'check-circle' },
];

export function matchesReminderFilter(item: Reminder, filter: VexReminderFilter): boolean {
  if (filter === 'done') return item.status === 'done';
  if (item.status !== 'pending') return false;
  return filter === 'pending' || item.bucket === filter;
}

/** Bucket order of the dashboard Bitácora: overdue first, then today, upcoming, no date. */
const BUCKET_RANK: Record<Reminder['bucket'], number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  no_date: 3,
  done: 4,
};

function instant(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/**
 * Reminders of one filter. Pending ones follow the dashboard order (bucket,
 * then due date); done ones show the most recently completed first.
 */
export function filterReminders(items: readonly Reminder[], filter: VexReminderFilter): Reminder[] {
  const matching = items.filter((item) => matchesReminderFilter(item, filter));
  if (filter === 'done') {
    return matching.sort(
      (a, b) => -instant(a.completed_at ?? a.updated_at) + instant(b.completed_at ?? b.updated_at),
    );
  }
  return matching.sort(
    (a, b) =>
      BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
      instant(a.remind_at) - instant(b.remind_at) ||
      a.id - b.id,
  );
}

export function countReminders(
  items: readonly Reminder[],
): Record<VexReminderFilter, number> {
  const counts: Record<VexReminderFilter, number> = {
    pending: 0,
    today: 0,
    overdue: 0,
    upcoming: 0,
    done: 0,
  };
  for (const item of items) {
    for (const meta of VEX_REMINDER_FILTERS) {
      if (matchesReminderFilter(item, meta.key)) counts[meta.key]++;
    }
  }
  return counts;
}

/**
 * Fingerprint of finished Vex activity: settled agent messages (a finished
 * turn, a voice receipt, an apply summary) plus the plan step being applied.
 * Vex creates, edits and completes reminders inside a turn and deletes them
 * through a confirmed step, so a change of this value is the moment the
 * sidebar re-reads the reminders. It stays equal while a turn streams.
 */
export function vexActivityFingerprint(
  conversations: readonly VexConversation[],
  busy_plan_id: string | null,
): string {
  let settled = 0;
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.role === 'agent' && !message.streaming) settled++;
    }
  }
  return `${settled}|${busy_plan_id ?? ''}`;
}

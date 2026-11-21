/**
 * Pure helpers of the Vex chat list: grouping by last activity and the
 * validation of a conversation name. No Angular, no clock of their own:
 * `now` is an input so the result is testable.
 */

export const VEX_TITLE_MAX_LENGTH = 80;

export const VEX_TITLE_EMPTY_ERROR = 'El nombre no puede estar vacío';
export const VEX_TITLE_TOO_LONG_ERROR = 'Máximo 80 caracteres';

/** Error of a conversation name, or `null` when its trimmed value is valid (1–80 characters). */
export function validateConversationTitle(raw: string): string | null {
  const title = raw.trim();
  if (title.length === 0) return VEX_TITLE_EMPTY_ERROR;
  if (title.length > VEX_TITLE_MAX_LENGTH) return VEX_TITLE_TOO_LONG_ERROR;
  return null;
}

export interface VexConversationGroup<T> {
  /** Stable key: `today`, `yesterday`, `last7` or `YYYY-MM`. */
  key: string;
  label: string;
  items: T[];
}

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const DAY_MS = 86_400_000;

/** Local calendar day number (days since epoch of the local midnight), DST-safe. */
function localDayNumber(date: Date): number {
  return Math.round(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS,
  );
}

/**
 * Groups conversations by the day of their last activity in the browser's
 * local time: «Hoy», «Ayer», «Últimos 7 días», then one group per month
 * («Octubre 2026»). Input order is kept inside each group and groups follow
 * the order in which they first appear, so a list sorted newest first yields
 * the groups newest first. Empty groups are never returned.
 */
export function groupConversationsByDate<T extends { updated_at: Date }>(
  items: readonly T[],
  now: Date = new Date(),
): VexConversationGroup<T>[] {
  const today = localDayNumber(now);
  const groups = new Map<string, VexConversationGroup<T>>();
  for (const item of items) {
    const age = today - localDayNumber(item.updated_at);
    let key: string;
    let label: string;
    if (age <= 0) {
      key = 'today';
      label = 'Hoy';
    } else if (age === 1) {
      key = 'yesterday';
      label = 'Ayer';
    } else if (age <= 7) {
      key = 'last7';
      label = 'Últimos 7 días';
    } else {
      const month = item.updated_at.getMonth();
      const year = item.updated_at.getFullYear();
      key = `${year}-${String(month + 1).padStart(2, '0')}`;
      label = `${MONTHS[month]} ${year}`;
    }
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, label, items: [item] });
  }
  return [...groups.values()];
}

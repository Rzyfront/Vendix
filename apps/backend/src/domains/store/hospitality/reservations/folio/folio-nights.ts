import { addDays } from '../reservation-status';
import { formatShortDate } from '../stay-dates';

/** Default night audit time when the store never set one (store time). */
export const DEFAULT_NIGHT_AUDIT_TIME = '02:00';

/**
 * Hospitality Suite (H3.4) — exclusive upper bound of the nights the night
 * audit charges now. From `night_audit_time` the night before today (the one
 * that just passed) is due; before it, only the nights up to the day before
 * yesterday. A night is never charged by the job before it was slept.
 *
 * @param today store-civil date `YYYY-MM-DD`
 * @param nowTime store-civil time `HH:mm`
 */
export function nightAuditCutoff(
  today: string,
  nowTime: string,
  auditTime: string = DEFAULT_NIGHT_AUDIT_TIME,
): string {
  return nowTime >= auditTime ? today : addDays(today, -1);
}

/** Folio line text of a night: "Noche 10-nov · Doble · 101". */
export function nightLineDescription(
  nightDate: string,
  typeName: string,
  unitCode: string | null,
): string {
  const parts = [`Noche ${formatShortDate(nightDate)}`, typeName];
  if (unitCode) parts.push(unitCode);
  return parts.join(' · ');
}

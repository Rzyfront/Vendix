import { localCivil, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { addDays } from '../reservation-status';
import { formatShortDate } from '../stay-dates';

const pad2 = (n: number) => String(n).padStart(2, '0');

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

/**
 * The store's civil date and its business day: before `night_audit_time` the
 * business day is still yesterday (the night in progress has not closed).
 */
export async function lodgingBusinessDate(
  prisma: StorePrismaService,
  store_id: number,
): Promise<{ today: string; business_date: string }> {
  const local = localCivil(new Date(), await resolveStoreTimezone(prisma, store_id));
  const today = `${local.year}-${pad2(local.month)}-${pad2(local.day)}`;
  const row = await prisma.store_settings.findFirst({
    where: { store_id },
    select: { settings: true },
  });
  const settings = row?.settings as { hospitality?: { night_audit_time?: string } } | null;
  const auditTime = settings?.hospitality?.night_audit_time || DEFAULT_NIGHT_AUDIT_TIME;
  const business_date = nightAuditCutoff(today, `${pad2(local.hour)}:${pad2(local.minute)}`, auditTime);
  return { today, business_date };
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

import type {
  BusinessHours,
  BusinessHoursBlock,
} from '../interfaces/store-settings.interface';

/**
 * Pure "next open time" helper.
 *
 * Replicates the reopening logic of `ScheduleValidationService.getNextOpenDay`
 * WITHOUT depending on Prisma or AsyncLocalStorage — it receives the raw
 * `pos.business_hours` map and the store timezone as arguments so it can be
 * called from any read path (e.g. PublicDomainsService) to build a fallback
 * "unavailable" message.
 *
 * @returns A Spanish message like `"Reabrimos: Lunes 08:00 - 18:00"` /
 *          `"Reabrimos: Hoy 09:00 - 13:00"`, or `null` when a next opening
 *          cannot be determined from the given schedule.
 */

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const SPANISH_DAYS: Record<string, string> = {
  sunday: 'Domingo',
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
};

/**
 * Extracts day-of-week (0=Sunday), hours and minutes for "now" in the given
 * IANA timezone using Intl.DateTimeFormat (no external dependencies).
 * Mirrors ScheduleValidationService.getDateInTimezone.
 */
function getDateInTimezone(timezone: string): {
  day: number;
  hours: number;
  minutes: number;
} {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);

    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || '';
    const hoursVal = parseInt(
      parts.find((p) => p.type === 'hour')?.value || '0',
      10,
    );
    const minutesVal = parseInt(
      parts.find((p) => p.type === 'minute')?.value || '0',
      10,
    );

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    // ICU can emit hour "24" at midnight; normalize to 0.
    const normalizedHours = hoursVal % 24;
    const dayVal = weekdayMap[weekdayStr] ?? now.getDay();

    return { day: dayVal, hours: normalizedHours, minutes: minutesVal };
  } catch {
    // Fallback to local time if timezone is invalid.
    return {
      day: now.getDay(),
      hours: now.getHours(),
      minutes: now.getMinutes(),
    };
  }
}

function formatBlocks(blocks: BusinessHoursBlock[]): string {
  return blocks
    .filter((b) => b.open !== 'closed' && b.close !== 'closed')
    .map((b) => `${b.open} - ${b.close}`)
    .join(', ');
}

/**
 * Finds the next open day/time. If "now" is before today's opening hour,
 * returns TODAY as the next opening. Returns null when nothing can be found.
 * Mirrors ScheduleValidationService.getNextOpenDay (minus the fallback string).
 */
function findNextOpen(
  businessHours: Record<string, BusinessHours>,
  currentDay: number,
  currentMinutes: number,
): string | null {
  // 1. Today may open later than "now".
  const todayName = DAY_NAMES[currentDay];
  const todayHours = businessHours[todayName];

  if (todayHours) {
    if (todayHours.blocks && todayHours.blocks.length > 0) {
      for (const block of todayHours.blocks) {
        if (block.open !== 'closed' && block.close !== 'closed') {
          const [openH, openM] = block.open.split(':').map(Number);
          const openMinutes = openH * 60 + openM;
          if (currentMinutes < openMinutes) {
            return `Hoy ${formatBlocks(todayHours.blocks)}`;
          }
        }
      }
    } else if (todayHours.open !== 'closed' && todayHours.close !== 'closed') {
      const [openH, openM] = todayHours.open.split(':').map(Number);
      const openMinutes = openH * 60 + openM;
      if (currentMinutes < openMinutes) {
        return `Hoy ${todayHours.open} - ${todayHours.close}`;
      }
    }
  }

  // 2. Check the next 7 days.
  for (let i = 1; i <= 7; i++) {
    const dayIndex = (currentDay + i) % 7;
    const dayName = DAY_NAMES[dayIndex];
    const hours = businessHours[dayName];

    if (!hours) continue;

    if (hours.blocks && hours.blocks.length > 0) {
      const hasOpen = hours.blocks.some(
        (b) => b.open !== 'closed' && b.close !== 'closed',
      );
      if (hasOpen) {
        return `${SPANISH_DAYS[dayName]} ${formatBlocks(hours.blocks)}`;
      }
    } else if (hours.open !== 'closed' && hours.close !== 'closed') {
      return `${SPANISH_DAYS[dayName]} ${hours.open} - ${hours.close}`;
    }
  }

  return null;
}

export function computeNextOpenMessage(
  businessHours: Record<string, BusinessHours> | undefined | null,
  timezone: string | undefined | null,
): string | null {
  if (!businessHours || typeof businessHours !== 'object') return null;

  const tz = timezone || 'America/Bogota';
  const { day, hours, minutes } = getDateInTimezone(tz);
  const currentMinutes = hours * 60 + minutes;

  const next = findNextOpen(businessHours, day, currentMinutes);
  if (!next) return null;

  return `Reabrimos: ${next}`;
}

export type DurationUnit = 'minute' | 'hour' | 'day';

const UNIT_MINUTES: Record<DurationUnit, number> = {
  minute: 1,
  hour: 60,
  day: 1440,
};

const UNIT_LABELS: Record<DurationUnit, { one: string; many: string }> = {
  minute: { one: 'min', many: 'min' },
  hour: { one: 'hora', many: 'horas' },
  day: { one: 'día', many: 'días' },
};

/** Stored minutes to the amount shown in its unit; falls back to minutes when the unit does not divide evenly. */
export function durationForDisplay(
  minutes: number | null | undefined,
  unit: string | null | undefined,
): { amount: number | null; unit: DurationUnit } {
  if (!minutes || minutes <= 0) return { amount: null, unit: 'minute' };
  const key = (unit ?? 'minute') as DurationUnit;
  const factor = UNIT_MINUTES[key] ?? 1;
  if (factor > 1 && minutes % factor === 0) return { amount: minutes / factor, unit: key };
  return { amount: minutes, unit: 'minute' };
}

/**
 * "45 min", "1 hora", "4 horas", "1 día", "2 días". A null unit reads as minutes
 * and a value that does not divide evenly falls back to minutes. `null` when
 * there is no duration.
 */
export function formatDurationUnit(
  minutes: number | null | undefined,
  unit: string | null | undefined,
): string | null {
  const shown = durationForDisplay(minutes, unit);
  if (shown.amount === null) return null;
  const label = UNIT_LABELS[shown.unit];
  return `${shown.amount} ${shown.amount === 1 ? label.one : label.many}`;
}

/** Short form for compact cards: "45 min", "2 h", "1 día", "3 días". */
export function formatDurationUnitShort(
  minutes: number | null | undefined,
  unit: string | null | undefined,
): string | null {
  const shown = durationForDisplay(minutes, unit);
  if (shown.amount === null) return null;
  if (shown.unit === 'hour') return `${shown.amount} h`;
  return formatDurationUnit(minutes, unit);
}

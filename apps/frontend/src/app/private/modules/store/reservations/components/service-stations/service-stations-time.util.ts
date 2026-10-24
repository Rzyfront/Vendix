/** Converts a datetime-local wall-clock value in an IANA timezone to a UTC ISO instant. */
export function storeWallTimeToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const wanted = match.slice(1).map(Number);
  const wallClockAsUtc = Date.UTC(wanted[0], wanted[1] - 1, wanted[2], wanted[3], wanted[4]);
  const candidates: number[] = [];
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  // IANA offsets use quarter-hour steps in current civil-time zones. Searching
  // the full supported offset range also detects nonexistent DST wall times.
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = wallClockAsUtc - offsetMinutes * 60_000;
    if (sameStoreWallTime(candidate, formatter, wanted)) candidates.push(candidate);
  }
  // During a repeated DST hour, choose the earlier of the two real instants.
  const instant = Math.min(...candidates);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}


function sameStoreWallTime(instant: number, formatter: Intl.DateTimeFormat, wanted: number[]): boolean {
  const parts = formatter.formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return values['year'] === wanted[0]
    && values['month'] === wanted[1]
    && values['day'] === wanted[2]
    && values['hour'] === wanted[3]
    && values['minute'] === wanted[4];
}

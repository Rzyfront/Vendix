/**
 * Hospitality Suite (H6.1) — pure iCalendar (RFC 5545) generator for the
 * per-room export feed that Airbnb/Booking import. Dates only: each busy run
 * of consecutive nights becomes one all-day event, with no guest data.
 */

export interface IcalBusyRange {
  /** First busy night, `YYYY-MM-DD`. */
  start: string;
  /** Day after the last busy night (exclusive end, like a departure). */
  end: string;
}

export interface IcalFeedInput {
  /** Stable id used in the event UIDs (the room id). */
  unit_id: number;
  /** Calendar name shown by the importer, e.g. `Hotel Sol · 101`. */
  calendar_name: string;
  /** Busy nights as `YYYY-MM-DD`, in any order, duplicates allowed. */
  nights: string[];
  /** Event summary; never personal data. */
  summary: string;
  now: Date;
}

const DAY_MS = 86_400_000;

function nextDay(date: string): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Sorted, deduplicated nights → runs of consecutive nights. */
export function mergeBusyNights(nights: string[]): IcalBusyRange[] {
  const sorted = [...new Set(nights)].sort();
  const ranges: IcalBusyRange[] = [];
  for (const night of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.end === night) {
      last.end = nextDay(night);
    } else {
      ranges.push({ start: night, end: nextDay(night) });
    }
  }
  return ranges;
}

/** Every night `YYYY-MM-DD` of `[from, to)`, clipped to start at `min`. */
export function nightsOfRange(from: string, to: string, min: string): string[] {
  const nights: string[] = [];
  for (let night = from < min ? min : from; night < to; night = nextDay(night)) {
    nights.push(night);
  }
  return nights;
}

/** RFC 5545 TEXT escaping. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 folding: lines over 75 octets continue on a line starting with a space. */
function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildIcalFeed(input: IcalFeedInput): string {
  const stamp = utcStamp(input.now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vendix//Hoteleria//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(input.calendar_name)}`,
  ];
  for (const range of mergeBusyNights(input.nights)) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:vendix-unit-${input.unit_id}-${compactDate(range.start)}@vendix`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(range.start)}`,
      `DTEND;VALUE=DATE:${compactDate(range.end)}`,
      `SUMMARY:${escapeText(input.summary)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

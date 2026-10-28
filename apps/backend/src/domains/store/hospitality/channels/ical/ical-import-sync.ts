import { createHash } from 'crypto';

/** One booked range of an imported calendar: nights `[from, to)`. */
export interface IcalImportEvent {
  uid: string;
  /** `YYYY-MM-DD`, first blocked night. */
  from: string;
  /** `YYYY-MM-DD`, the room is free again this night (exclusive). */
  to: string;
}

/** An active block already created by the same import. */
export interface IcalImportedBlock {
  id: number;
  external_uid: string | null;
  from: string;
  to: string;
}

export interface IcalImportDiff {
  create: IcalImportEvent[];
  update: { id: number; from: string; to: string }[];
  release: number[];
}

/** Column size of `lodging_inventory_blocks.external_uid`. */
const MAX_UID_LENGTH = 255;

const DAY_MS = 86_400_000;

/** RFC 5545 §3.1: a line starting with a space or tab continues the previous one. */
const unfold = (text: string) => text.replace(/\r?\n[ \t]/g, '');

/** `YYYYMMDD` (DATE) or `YYYYMMDDTHHMMSS[Z]` (DATE-TIME) → `YYYY-MM-DD`. */
function parseDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
}

const addDays = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** UIDs longer than the column are hashed (stable, so the diff still matches). */
const normalizeUid = (uid: string) =>
  uid.length <= MAX_UID_LENGTH ? uid : `sha256:${createHash('sha256').update(uid).digest('hex')}`;

/**
 * Hospitality Suite (H6.2) — reads the booked ranges of an iCal feed
 * (Airbnb, Booking). Only dates and the UID: channels send neither price nor
 * guest. All-day events block `[DTSTART, DTEND)`; a DATE-TIME keeps its date;
 * a missing DTEND blocks one night. Cancelled and empty events are skipped.
 * An event without UID is keyed by its dates.
 */
export function parseIcalEvents(text: string): IcalImportEvent[] {
  const events = new Map<string, IcalImportEvent>();
  let current: Record<string, string> | null = null;
  for (const line of unfold(text).split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0].trim().toUpperCase();
    const value = line.slice(colon + 1);
    if (name === 'BEGIN' && value.trim().toUpperCase() === 'VEVENT') {
      current = {};
    } else if (name === 'END' && value.trim().toUpperCase() === 'VEVENT') {
      const event = current && toEvent(current);
      if (event && !events.has(event.uid)) events.set(event.uid, event);
      current = null;
    } else if (current && !(name in current)) {
      current[name] = value;
    }
  }
  return [...events.values()];
}

function toEvent(props: Record<string, string>): IcalImportEvent | null {
  if (props.STATUS?.trim().toUpperCase() === 'CANCELLED') return null;
  const from = props.DTSTART ? parseDate(props.DTSTART) : null;
  if (!from) return null;
  const to = (props.DTEND && parseDate(props.DTEND)) || addDays(from, 1);
  if (to <= from) return null;
  const uid = props.UID?.trim() || `${from}/${to}`;
  return { uid: normalizeUid(uid), from, to };
}

/**
 * What a sync changes on the room's imported blocks, keyed by event UID:
 * new UIDs become blocks, moved dates update theirs, UIDs gone from the feed
 * (cancelled there) are released. The past is left alone: events that ended
 * before `today` are ignored and a block already over is never touched, so
 * a channel trimming its history does not rewrite it in Vendix.
 */
export function diffIcalBlocks(
  events: IcalImportEvent[],
  existing: IcalImportedBlock[],
  today: string,
): IcalImportDiff {
  const upcoming = new Map(events.filter((e) => e.to > today).map((e) => [e.uid, e]));
  const diff: IcalImportDiff = { create: [], update: [], release: [] };
  const matched = new Set<string>();
  for (const block of existing) {
    const event = block.external_uid ? upcoming.get(block.external_uid) : undefined;
    if (!event || matched.has(event.uid)) {
      if (block.to > today) diff.release.push(block.id);
      continue;
    }
    matched.add(event.uid);
    if (event.from !== block.from || event.to !== block.to) {
      diff.update.push({ id: block.id, from: event.from, to: event.to });
    }
  }
  for (const event of upcoming.values()) {
    if (!matched.has(event.uid)) diff.create.push(event);
  }
  return diff;
}

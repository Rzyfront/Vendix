/**
 * Rate windows (S18) — pure pricing kernel.
 *
 * Rule: each block of a rental is priced at the window in which the block
 * STARTS, evaluated in the store timezone. A window on the previous weekday
 * that crosses midnight covers the early minutes of the next day (A5). No match
 * means the station base price. Blocks are never split or prorated.
 *
 * Money is handled in integer cents: every block price goes through
 * `priceToCents` before summing.
 */
import { localCivil } from './store-timezone.util';
import { validateWeeklyBlocks, windowSpan } from './schedule-window.util';

const DAY_MIN = 1440;
const MINUTE_MS = 60_000;

export interface RateWindow {
  id?: number | null;
  weekday: number;
  start_time: string;
  end_time: string;
  block_price: number | string | { toString(): string };
  is_active?: boolean | null;
}

export interface BlockQuote {
  startAt: Date;
  cents: number;
  windowId: number | null;
}

export interface QuoteBlocksResult {
  cents: number;
  perBlock: BlockQuote[];
}

export interface QuoteBlocksInput {
  startAt: Date;
  blockMinutes: number;
  blocks: number;
  windows: RateWindow[];
  basePrice: number | string | { toString(): string };
  tz: string;
}

export function priceToCents(price: RateWindow['block_price']): number {
  return Math.round(Number(price) * 100);
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Window that covers `minuteOfDay` of `weekday`, including the previous day's overnight spill. */
function findWindow(windows: RateWindow[], weekday: number, minuteOfDay: number): RateWindow | null {
  const prev = (weekday + 6) % 7;
  for (const w of windows) {
    if (w.is_active === false) continue;
    const span = windowSpan(w);
    if (w.weekday === weekday && minuteOfDay >= span.startMin && minuteOfDay < span.endMin) return w;
    if (w.weekday === prev && span.endMin > DAY_MIN && minuteOfDay < span.endMin - DAY_MIN) return w;
  }
  return null;
}

export function quoteBlocks(input: QuoteBlocksInput): QuoteBlocksResult {
  const { startAt, blockMinutes, blocks, windows, basePrice, tz } = input;
  const baseCents = priceToCents(basePrice);
  const perBlock: BlockQuote[] = [];
  let cents = 0;
  for (let i = 0; i < blocks; i++) {
    const blockStart = new Date(startAt.getTime() + i * blockMinutes * MINUTE_MS);
    const civil = localCivil(blockStart, tz);
    const w = findWindow(windows, weekdayOf(civil.year, civil.month, civil.day), civil.hour * 60 + civil.minute);
    const blockCents = w ? priceToCents(w.block_price) : baseCents;
    perBlock.push({ startAt: blockStart, cents: blockCents, windowId: w?.id ?? null });
    cents += blockCents;
  }
  return { cents, perBlock };
}

/** Validates a weekly set of windows: HH:MM format and no overlap (overnight allowed). */
export function validateRateWindows(
  windows: Array<Pick<RateWindow, 'weekday' | 'start_time' | 'end_time'>>,
): { day: number; reason: 'format' | 'overlap' } | null {
  return validateWeeklyBlocks(windows.map((w) => ({ day: w.weekday, start_time: w.start_time, end_time: w.end_time })));
}

import { Prisma } from '@prisma/client';
import { zonedWallClockToUtc } from '@common/utils/store-timezone.util';

/**
 * Hospitality Suite (H2.4) — cancellation penalty and deposit of a stay.
 * Pure: the reservation computes them from the policy snapshot of each room,
 * so later edits to the policy never change a sold reservation. The penalty
 * is only computed and shown here; charging or keeping it is H3.5.
 */

export const PENALTY_TYPES = ['nights', 'percent'] as const;
export type PenaltyType = (typeof PENALTY_TYPES)[number];

/** "1 noche" (first N nights of the stay) or "50 %" (of the room total). */
export interface PenaltyTerm {
  penalty_type: PenaltyType;
  penalty_value: number;
}

/** Applies when cancelling less than `hours_before` hours before check-in. */
export interface CancellationRule extends PenaltyTerm {
  hours_before: number;
}

/** What a room keeps of its plan's policy when it is sold. */
export interface CancellationPolicySnapshot {
  id: number;
  name: string;
  rules: CancellationRule[];
  no_show_penalty: PenaltyTerm | null;
}

export interface Penalty {
  amount: Prisma.Decimal;
  /** "1 noche", "2 noches", "50 %". */
  detail: string;
}

export type PenaltyEvent = 'cancel' | 'no_show';

const ZERO = new Prisma.Decimal(0);

/** Reads a stored snapshot; anything without a rules list counts as no policy. */
export function asPolicySnapshot(value: unknown): CancellationPolicySnapshot | null {
  if (!value || typeof value !== 'object') return null;
  return Array.isArray((value as { rules?: unknown }).rules)
    ? (value as CancellationPolicySnapshot)
    : null;
}

function termDetail(term: PenaltyTerm): string {
  if (term.penalty_type === 'percent') return `${term.penalty_value} %`;
  return `${term.penalty_value} ${term.penalty_value === 1 ? 'noche' : 'noches'}`;
}

/** Money of a term over the room's nights (in stay order) and total. */
function termAmount(term: PenaltyTerm, nights: readonly Prisma.Decimal[], total: Prisma.Decimal) {
  if (term.penalty_type === 'percent') {
    return total.mul(term.penalty_value).div(100).toDecimalPlaces(2);
  }
  return nights.slice(0, term.penalty_value).reduce((sum, night) => sum.add(night), ZERO);
}

/**
 * Penalty of one room: a no-show takes the policy's no-show term; a
 * cancellation takes the narrowest window it falls in (`hours < hours_before`).
 * Null = free.
 */
export function roomPenalty(
  room: { policy: CancellationPolicySnapshot | null; nights: readonly Prisma.Decimal[]; total: Prisma.Decimal },
  hoursBefore: number,
  event: PenaltyEvent,
): Penalty | null {
  if (!room.policy) return null;
  const term =
    event === 'no_show'
      ? room.policy.no_show_penalty
      : ([...room.policy.rules]
          .filter((rule) => hoursBefore < rule.hours_before)
          .sort((a, b) => a.hours_before - b.hours_before)[0] ?? null);
  if (!term || term.penalty_value <= 0) return null;
  const amount = termAmount(term, room.nights, room.total);
  return amount.gt(0) ? { amount, detail: termDetail(term) } : null;
}

/** Reservation penalty: rooms added, one detail per distinct term. */
export function combinePenalties(penalties: ReadonlyArray<Penalty | null>): Penalty | null {
  const charged = penalties.filter((p): p is Penalty => p !== null);
  if (charged.length === 0) return null;
  return {
    amount: charged.reduce((sum, p) => sum.add(p.amount), ZERO),
    detail: [...new Set(charged.map((p) => p.detail))].join(' + '),
  };
}

/**
 * Deposit asked for the active rooms: each room's percent of its total.
 * `percent` is set only when every room asks the same (shown as "30 %").
 */
export function depositRequired(
  rooms: ReadonlyArray<{ deposit_percent: Prisma.Decimal; total: Prisma.Decimal }>,
): { percent: string | null; amount: string } {
  const amount = rooms.reduce(
    (sum, room) => sum.add(room.total.mul(room.deposit_percent).div(100).toDecimalPlaces(2)),
    ZERO,
  );
  const percents = [...new Set(rooms.map((room) => room.deposit_percent.toString()))];
  const percent = percents.length === 1 && !rooms[0].deposit_percent.isZero() ? percents[0] : null;
  return { percent, amount: amount.toFixed(2) };
}

/** Hours from `now` to the check-in time (`HH:mm`, store zone) of the arrival day. */
export function hoursBeforeCheckIn(
  arrival_date: string,
  check_in_time: string,
  timezone: string,
  now: Date,
): number {
  const [year, month, day] = arrival_date.split('-').map(Number);
  const [hour, minute] = check_in_time.split(':').map(Number);
  const checkIn = zonedWallClockToUtc(year, month, day, hour || 0, minute || 0, 0, 0, timezone);
  return (checkIn.getTime() - now.getTime()) / 3_600_000;
}

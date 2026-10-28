import { Injectable } from '@nestjs/common';
import { lodging_reservation_status_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { addDays } from '../reservation-status';
import { dateOnlyToDb } from '../stay-dates';
import { lodgingKpis } from './lodging-kpis';

/** Default and longest horizon of the forecast, in stay dates. */
export const DEFAULT_PICKUP_DAYS = 90;
export const MAX_PICKUP_DAYS = 365;

/** Pickup windows: nights booked in the last N days. */
const PICKUP_WINDOWS = { pickup_7: 7, pickup_30: 30 } as const;

/** Firm reservations: a web hold (tentative) is not on the books yet. */
const ON_BOOKS_STATUSES: lodging_reservation_status_enum[] = ['confirmed', 'checked_in'];

/** One stay date (or the whole horizon, in totals). */
export interface LodgingPickupRow {
  /** Rooms available: active rooms (summed over the horizon in totals). */
  rooms: number;
  /** Nights sold for the date and still active. */
  on_books: number;
  /** Of those, booked in the last 7 days. */
  pickup_7: number;
  /** Of those, booked in the last 30 days. */
  pickup_30: number;
  /** on_books / rooms, in %; null without rooms. */
  projected_occupancy_pct: number | null;
}

export interface LodgingPickupDayRow extends LodgingPickupRow {
  stay_date: string;
}

export interface LodgingPickupReport {
  from: string;
  to: string;
  totals: LodgingPickupRow;
  days: LodgingPickupDayRow[];
}

type Counts = Omit<LodgingPickupRow, 'rooms' | 'projected_occupancy_pct'>;

/**
 * Hospitality Suite (H7.3) — pickup and forecast. For each stay date from the
 * store today, the nights on the books of firm reservations and how many of
 * them were booked in the last 7 and 30 days. A night is booked when its row
 * is created (a new reservation, an extension or a room change that adds the
 * date); modifying a reservation keeps its nights, so they are not counted
 * again. Projected occupancy = nights on the books / active rooms.
 */
@Injectable()
export class LodgingPickupService {
  constructor(private readonly prisma: StorePrismaService) {}

  async get(query: { days?: number }): Promise<LodgingPickupReport> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const span = query.days ?? DEFAULT_PICKUP_DAYS;
    if (!Number.isInteger(span) || span < 1 || span > MAX_PICKUP_DAYS) {
      throw new VendixHttpException(ErrorCodes.LODGING_PICKUP_RANGE_001);
    }
    const now = new Date();
    const from = localDateString(now, await resolveStoreTimezone(this.prisma, store_id));
    const to = addDays(from, span - 1);

    const [rooms, nights] = await Promise.all([
      this.prisma.lodging_units.count({ where: { is_active: true } }),
      this.prisma.lodging_room_nights.findMany({
        where: {
          is_active: true,
          night_date: { gte: dateOnlyToDb(from), lte: dateOnlyToDb(to) },
          reservation_room: {
            cancelled_at: null,
            reservation: { status: { in: ON_BOOKS_STATUSES } },
          },
        },
        select: { night_date: true, created_at: true },
      }),
    ]);

    const cutoffs = Object.entries(PICKUP_WINDOWS).map(
      ([key, windowDays]) => [key as keyof typeof PICKUP_WINDOWS, now.getTime() - windowDays * 86_400_000] as const,
    );
    const byDate = new Map<string, Counts>();
    for (const n of nights) {
      const date = n.night_date.toISOString().slice(0, 10);
      const counts = byDate.get(date) ?? { on_books: 0, pickup_7: 0, pickup_30: 0 };
      counts.on_books += 1;
      const created = n.created_at?.getTime();
      for (const [key, cutoff] of cutoffs) {
        if (created !== undefined && created >= cutoff) counts[key] += 1;
      }
      byDate.set(date, counts);
    }

    const total: Counts = { on_books: 0, pickup_7: 0, pickup_30: 0 };
    const days: LodgingPickupDayRow[] = [];
    for (let i = 0; i < span; i++) {
      const stay_date = addDays(from, i);
      const counts = byDate.get(stay_date) ?? { on_books: 0, pickup_7: 0, pickup_30: 0 };
      total.on_books += counts.on_books;
      total.pickup_7 += counts.pickup_7;
      total.pickup_30 += counts.pickup_30;
      days.push({ stay_date, ...row(rooms, counts) });
    }
    return { from, to, totals: row(rooms * span, total), days };
  }
}

function row(rooms: number, counts: Counts): LodgingPickupRow {
  return {
    rooms,
    ...counts,
    projected_occupancy_pct: lodgingKpis(counts.on_books, rooms, 0).occupancy_pct,
  };
}

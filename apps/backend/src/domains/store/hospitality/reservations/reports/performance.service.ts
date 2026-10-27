import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { daysBetweenDateStrings, localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { round2 } from '../../../analytics/analytics-metrics.contract';
import type { NightAuditSummary } from '../night-audit/night-audit.service';
import { addDays } from '../reservation-status';
import { dateOnlyToDb } from '../stay-dates';
import { LodgingKpis, lodgingKpis } from './lodging-kpis';

/** Longest period the report accepts, in business days. */
export const MAX_PERFORMANCE_DAYS = 366;

/** One business day or month of the report. */
export interface LodgingPerformanceRow extends LodgingKpis {
  /** `YYYY-MM-DD` for a day, `YYYY-MM` for a month. */
  period: string;
  nights_available: number;
  nights_sold: number;
  room_revenue: number;
}

export interface LodgingPerformanceDayRow extends LodgingPerformanceRow {
  /** true: figures frozen by the night audit (H7.1); false: live. */
  closed: boolean;
}

export interface LodgingPerformanceReport {
  from: string;
  to: string;
  totals: LodgingPerformanceRow;
  days: LodgingPerformanceDayRow[];
  months: LodgingPerformanceRow[];
}

interface DayFigures {
  closed: boolean;
  available: number;
  sold: number;
  revenueCents: number;
}

/**
 * Hospitality Suite (H7.2) — occupancy, ADR and RevPAR by business day and
 * month. A day closed by the night audit (H7.1) uses its frozen snapshot
 * (rooms, rooms occupied, room revenue); any other day uses the live nights
 * with the same rule as "Cerrar día": a night is sold when the guest is in
 * house or already left, its revenue is the pre-tax amount of its live folio
 * line, and the rooms available are the active rooms of the hotel.
 */
@Injectable()
export class LodgingPerformanceService {
  constructor(private readonly prisma: StorePrismaService) {}

  async get(query: { from?: string; to?: string }): Promise<LodgingPerformanceReport> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    // Business days are store-civil dates: "today" is the store's.
    const today = localDateString(new Date(), await resolveStoreTimezone(this.prisma, store_id));
    const from = query.from ?? `${today.slice(0, 8)}01`;
    // No figures yet for days to come (forecast is H7.3).
    const to = !query.to || query.to > today ? today : query.to;
    const span = daysBetweenDateStrings(from, to) + 1;
    if (!(span >= 1) || span > MAX_PERFORMANCE_DAYS) {
      throw new VendixHttpException(ErrorCodes.LODGING_PERFORMANCE_RANGE_001);
    }

    const audits = await this.prisma.lodging_night_audits.findMany({
      where: { status: 'closed', business_date: { gte: dateOnlyToDb(from), lte: dateOnlyToDb(to) } },
      select: { business_date: true, summary: true },
    });
    const figures = new Map<string, DayFigures>();
    for (const audit of audits) {
      const summary = audit.summary as unknown as NightAuditSummary;
      figures.set(audit.business_date.toISOString().slice(0, 10), {
        closed: true,
        available: summary.rooms_total,
        sold: summary.rooms_occupied,
        revenueCents: Math.round(Number(summary.room_revenue) * 100),
      });
    }

    const closedDates = [...figures.keys()].map(dateOnlyToDb);
    const [rooms, nights] = await Promise.all([
      this.prisma.lodging_units.count({ where: { is_active: true } }),
      this.prisma.lodging_room_nights.findMany({
        where: {
          is_active: true,
          night_date: { gte: dateOnlyToDb(from), lte: dateOnlyToDb(to), notIn: closedDates },
          reservation_room: {
            cancelled_at: null,
            reservation: { status: { in: ['checked_in', 'checked_out'] } },
          },
        },
        select: {
          night_date: true,
          posted_order_item: { select: { total_price: true, cancelled_at: true } },
        },
      }),
    ]);
    for (let i = 0; i < span; i++) {
      const date = addDays(from, i);
      if (!figures.has(date)) figures.set(date, { closed: false, available: rooms, sold: 0, revenueCents: 0 });
    }
    for (const night of nights) {
      const day = figures.get(night.night_date.toISOString().slice(0, 10));
      if (!day || day.closed) continue;
      day.sold += 1;
      const item = night.posted_order_item;
      if (item && !item.cancelled_at) day.revenueCents += Math.round(Number(item.total_price) * 100);
    }

    const days: LodgingPerformanceDayRow[] = [];
    const monthly = new Map<string, DayFigures>();
    const total: DayFigures = { closed: false, available: 0, sold: 0, revenueCents: 0 };
    for (let i = 0; i < span; i++) {
      const date = addDays(from, i);
      const day = figures.get(date)!;
      days.push({ ...row(date, day), closed: day.closed });
      const month = date.slice(0, 7);
      const acc = monthly.get(month) ?? { closed: false, available: 0, sold: 0, revenueCents: 0 };
      accumulate(acc, day);
      monthly.set(month, acc);
      accumulate(total, day);
    }
    return {
      from,
      to,
      totals: row(`${from}/${to}`, total),
      days,
      months: [...monthly].map(([month, acc]) => row(month, acc)),
    };
  }
}

function accumulate(acc: DayFigures, day: DayFigures): void {
  acc.available += day.available;
  acc.sold += day.sold;
  acc.revenueCents += day.revenueCents;
}

function row(period: string, f: DayFigures): LodgingPerformanceRow {
  const room_revenue = round2(f.revenueCents / 100);
  return {
    period,
    nights_available: f.available,
    nights_sold: f.sold,
    room_revenue,
    ...lodgingKpis(f.sold, f.available, room_revenue),
  };
}

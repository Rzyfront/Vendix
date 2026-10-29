import { Injectable } from '@nestjs/common';
import { lodging_reservation_status_enum, Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import {
  daysBetweenDateStrings,
  localDateString,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { round2 } from '../../../analytics/analytics-metrics.contract';
import { addDays } from '../reservation-status';
import { stayNights } from '../stay-dates';
import { channelOf, channelWhere, LodgingChannel } from './reservation-channel';

/** Longest period the report accepts, in business days. */
export const MAX_LOSSES_DAYS = 366;
/** Rows per report; a hotel never gets close in one year. */
export const MAX_LOSSES_ROWS = 10_000;

export const LOSS_TYPES = ['cancelled', 'no_show'] as const;
export type LodgingLossType = (typeof LOSS_TYPES)[number];

/** A loss is leaving a firm status; an unpaid web hold that expires is not a lost booking. */
const FIRM_STATUSES: lodging_reservation_status_enum[] = ['confirmed', 'checked_in'];

export interface LodgingLossRow {
  reservation_id: number;
  reservation_number: string;
  type: LodgingLossType;
  channel: LodgingChannel;
  guest_name: string;
  /** Moment of the cancellation or no-show. */
  occurred_at: Date;
  /** Its store-civil day (`YYYY-MM-DD`). */
  occurred_on: string;
  arrival_date: string;
  departure_date: string;
  nights: number;
  /** Value of the stay lost. */
  total_amount: number;
  /** Penalty computed by the cancellation policy (H2.4); 0 without one. */
  penalty_amount: number;
  penalty_detail: string | null;
  reason: string | null;
}

export interface LodgingLossTotals {
  cancellations: number;
  no_shows: number;
  lost_amount: number;
  penalty_amount: number;
}

export interface LodgingLossesReport {
  from: string;
  to: string;
  timezone: string;
  totals: LodgingLossTotals;
  rows: LodgingLossRow[];
}

export interface LodgingLossesQuery {
  from?: string;
  to?: string;
  channel?: LodgingChannel;
  type?: LodgingLossType;
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

/**
 * Hospitality Suite (H7.4) — no-shows and cancellations by channel with their
 * penalties. One row per reservation that left a firm status for `cancelled`
 * or `no_show` in the period (by the store-civil day it happened), with the
 * stay value lost and the policy penalty. Screen and XLSX read this dataset.
 */
@Injectable()
export class LodgingCancellationsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async get(query: LodgingLossesQuery): Promise<LodgingLossesReport> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = localDateString(new Date(), timezone);
    const from = query.from ?? `${today.slice(0, 8)}01`;
    const to = query.to ?? today;
    const span = daysBetweenDateStrings(from, to) + 1;
    if (!(span >= 1) || span > MAX_LOSSES_DAYS) {
      throw new VendixHttpException(ErrorCodes.LODGING_LOSSES_RANGE_001);
    }

    const where: Prisma.lodging_reservation_eventsWhereInput = {
      to_status: { in: query.type ? [query.type] : [...LOSS_TYPES] },
      from_status: { in: FIRM_STATUSES },
      created_at: { gte: localStart(from, timezone), lt: localStart(addDays(to, 1), timezone) },
    };
    if (query.channel) where.reservation = channelWhere(query.channel);

    const events = await this.prisma.lodging_reservation_events.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      // One extra row tells a truncated period apart from an exact fit.
      take: MAX_LOSSES_ROWS + 1,
      select: {
        id: true,
        to_status: true,
        reason: true,
        created_at: true,
        reservation: {
          select: {
            id: true,
            reservation_number: true,
            arrival_date: true,
            departure_date: true,
            total_amount: true,
            cancellation_penalty_amount: true,
            cancellation_penalty_detail: true,
            customer: { select: { first_name: true, last_name: true } },
            events: { where: { from_status: null }, select: { to_status: true }, take: 1 },
          },
        },
      },
    });
    // Totals over a cut dataset would lie: ask for a shorter period instead.
    if (events.length > MAX_LOSSES_ROWS) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_LOSSES_RANGE_001,
        'El periodo tiene más de 10.000 cancelaciones y no presentados: elige un periodo más corto',
      );
    }

    const totals: LodgingLossTotals = { cancellations: 0, no_shows: 0, lost_amount: 0, penalty_amount: 0 };
    let lostCents = 0;
    let penaltyCents = 0;
    const rows = events.map((e): LodgingLossRow => {
      const r = e.reservation;
      const type = e.to_status as LodgingLossType;
      const arrival_date = dateOnly(r.arrival_date);
      const departure_date = dateOnly(r.departure_date);
      const total_amount = round2(Number(r.total_amount));
      const penalty_amount = round2(Number(r.cancellation_penalty_amount ?? 0));
      if (type === 'no_show') totals.no_shows += 1;
      else totals.cancellations += 1;
      lostCents += Math.round(total_amount * 100);
      penaltyCents += Math.round(penalty_amount * 100);
      const occurred_at = e.created_at ?? new Date(0);
      return {
        reservation_id: r.id,
        reservation_number: r.reservation_number,
        type,
        channel: channelOf(r.events[0]),
        guest_name: [r.customer?.first_name, r.customer?.last_name].filter(Boolean).join(' '),
        occurred_at,
        occurred_on: localDateString(occurred_at, timezone),
        arrival_date,
        departure_date,
        nights: stayNights(arrival_date, departure_date).length,
        total_amount,
        penalty_amount,
        penalty_detail: r.cancellation_penalty_detail ?? null,
        reason: e.reason ?? null,
      };
    });
    totals.lost_amount = lostCents / 100;
    totals.penalty_amount = penaltyCents / 100;
    return { from, to, timezone, totals, rows };
  }
}

/** UTC instant of 00:00 of a store-civil date. */
function localStart(date: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return zonedWallClockToUtc(year, month, day, 0, 0, 0, 0, timezone);
}

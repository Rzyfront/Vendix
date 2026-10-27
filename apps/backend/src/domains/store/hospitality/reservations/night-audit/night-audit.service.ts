import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingFolioService } from '../folio/folio.service';
import { lodgingBusinessDate } from '../folio/folio-nights';
import { LodgingReservationsService } from '../reservations.service';
import { addDays } from '../reservation-status';
import { dateOnlyToDb } from '../stay-dates';

export interface NightAuditReservationRow {
  id: number;
  reservation_number: string;
  guest_name: string;
}

export interface NightAuditDiscrepancy {
  reservation_id: number;
  reservation_number: string;
  /** "101 · Doble" (or the type alone when unassigned). */
  room: string;
  rate_amount: string;
  /** not_posted: the night has no folio line; voided: its line was voided. */
  reason: 'not_posted' | 'voided';
}

/** Snapshot of the business day stored when it closes. */
export interface NightAuditSummary {
  business_date: string;
  rooms_total: number;
  rooms_occupied: number;
  nights_posted: number;
  /** Pre-tax amount of the night lines posted for the day. */
  room_revenue: string;
  no_shows: NightAuditReservationRow[];
  pending_arrivals: NightAuditReservationRow[];
  discrepancies: NightAuditDiscrepancy[];
}

export interface NightAuditView {
  business_date: string;
  /** open: never closed; closed: frozen; reopened: unfrozen with a reason. */
  status: 'open' | 'closed' | 'reopened';
  closed_at: Date | null;
  closed_by: string | null;
  reopened_at: Date | null;
  reopened_by: string | null;
  reopen_reason: string | null;
  /** Stored snapshot when closed, live figures otherwise. */
  summary: NightAuditSummary;
}

const guestName = (customer: { first_name: string | null; last_name: string | null } | null) =>
  [customer?.first_name, customer?.last_name].filter(Boolean).join(' ');

/**
 * Hospitality Suite (H7.1) — night audit. "Cerrar día" posts the nights of
 * the business day to every in-house folio (H3.4), moves the pending arrivals
 * to no-show (H1.2) and stores a summary: nights charged, no-shows, pending
 * arrivals and the discrepancies (occupied nights without a live folio line).
 * A closed day is frozen: the folio does not post or void nights of that date
 * until a user with `store:lodging:night_audit:reopen` reopens it.
 */
@Injectable()
export class LodgingNightAuditService {
  private readonly logger = new Logger(LodgingNightAuditService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly folios: LodgingFolioService,
    private readonly reservations: LodgingReservationsService,
  ) {}

  /** The day as "Cerrar día" shows it. Default: the current business day. */
  async get(date?: string): Promise<NightAuditView> {
    const business_date = date ?? (await this.clock()).business_date;
    const audit = await this.findAudit(business_date);
    const names = await this.userNames([audit?.closed_by_user_id, audit?.reopened_by_user_id]);
    return {
      business_date,
      status: (audit?.status as NightAuditView['status']) ?? 'open',
      closed_at: audit?.closed_at ?? null,
      closed_by: names.get(audit?.closed_by_user_id ?? 0) ?? null,
      reopened_at: audit?.reopened_at ?? null,
      reopened_by: names.get(audit?.reopened_by_user_id ?? 0) ?? null,
      reopen_reason: audit?.reopen_reason ?? null,
      summary:
        audit?.status === 'closed'
          ? (audit.summary as unknown as NightAuditSummary)
          : await this.summarize(business_date),
    };
  }

  /** "Cerrar día": posts the nights, marks no-shows and freezes the day. */
  async close(date?: string, markNoShows = true): Promise<NightAuditView> {
    const { today, business_date: current } = await this.clock();
    const business_date = date ?? current;
    if (business_date > today) throw new VendixHttpException(ErrorCodes.LODGING_NIGHT_AUDIT_DATE_001);
    const existing = await this.findAudit(business_date);
    if (existing?.status === 'closed') {
      throw new VendixHttpException(
        ErrorCodes.LODGING_NIGHT_AUDIT_CLOSED_001,
        `El día ${business_date} ya está cerrado`,
      );
    }
    const user_id = RequestContextService.getContext()?.user_id ?? null;

    // H3.4 — every in-house folio gets its nights up to this day.
    const folios = await this.prisma.lodging_folios.findMany({
      where: { status: 'open', reservation: { status: 'checked_in' } },
      select: { id: true, status: true, reservation_id: true, order_id: true },
    });
    for (const folio of folios) {
      try {
        await this.folios.postNightsThrough(folio, business_date, true);
      } catch (err: unknown) {
        // A folio that fails shows up as a discrepancy; the close goes on.
        this.logger.error(
          `Night audit ${business_date}: folio ${folio.id} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    // H1.2 — arrivals up to this day that never checked in.
    if (markNoShows) {
      await this.reservations.autoNoShow(addDays(business_date, 1), `Cierre del día ${business_date}`, user_id);
    }

    const summary = (await this.summarize(business_date)) as unknown as Prisma.InputJsonValue;
    const now = new Date();
    const data = { status: 'closed', summary, closed_at: now, closed_by_user_id: user_id, updated_at: now };
    if (existing) {
      // Reopened day: only one concurrent close wins.
      const updated = await this.prisma.lodging_night_audits.updateMany({
        where: { id: existing.id, status: 'reopened' },
        data,
      });
      if (updated.count !== 1) throw this.alreadyClosed(business_date);
    } else {
      try {
        await this.prisma.lodging_night_audits.create({
          data: { ...data, store_id: this.requireStoreId(), business_date: dateOnlyToDb(business_date) },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw this.alreadyClosed(business_date);
        }
        throw error;
      }
    }
    return this.get(business_date);
  }

  /** "Reabrir día": unfreezes a closed day, with a reason. */
  async reopen(date: string, reason: string): Promise<NightAuditView> {
    const now = new Date();
    const updated = await this.prisma.lodging_night_audits.updateMany({
      where: { business_date: dateOnlyToDb(date), status: 'closed' },
      data: {
        status: 'reopened',
        reopened_at: now,
        reopened_by_user_id: RequestContextService.getContext()?.user_id ?? null,
        reopen_reason: reason.trim(),
        updated_at: now,
      },
    });
    if (updated.count !== 1) throw new VendixHttpException(ErrorCodes.LODGING_NIGHT_AUDIT_REOPEN_001);
    return this.get(date);
  }

  /** Live figures of a business day. */
  async summarize(business_date: string): Promise<NightAuditSummary> {
    const day = dateOnlyToDb(business_date);
    const reservationSelect = {
      id: true,
      reservation_number: true,
      customer: { select: { first_name: true, last_name: true } },
    } as const;
    const [rooms_total, nights, noShows, pending] = await Promise.all([
      this.prisma.lodging_units.count({ where: { is_active: true } }),
      // Nights actually slept: the guest is in house or already left.
      this.prisma.lodging_room_nights.findMany({
        where: {
          is_active: true,
          night_date: day,
          reservation_room: {
            cancelled_at: null,
            reservation: { status: { in: ['checked_in', 'checked_out'] } },
          },
        },
        select: {
          rate_amount: true,
          unit: { select: { code: true } },
          unit_type: { select: { name: true } },
          posted_order_item: { select: { total_price: true, cancelled_at: true } },
          reservation_room: { select: { reservation: { select: { id: true, reservation_number: true } } } },
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.lodging_reservations.findMany({
        where: { status: 'no_show', arrival_date: day },
        select: reservationSelect,
        orderBy: { id: 'asc' },
      }),
      this.prisma.lodging_reservations.findMany({
        where: { status: 'confirmed', arrival_date: { lte: day } },
        select: reservationSelect,
        orderBy: { id: 'asc' },
      }),
    ]);

    let nights_posted = 0;
    let revenueCents = 0;
    const discrepancies: NightAuditDiscrepancy[] = [];
    for (const night of nights) {
      const item = night.posted_order_item;
      if (item && !item.cancelled_at) {
        nights_posted += 1;
        revenueCents += Math.round(Number(item.total_price) * 100);
        continue;
      }
      const reservation = night.reservation_room.reservation;
      discrepancies.push({
        reservation_id: reservation.id,
        reservation_number: reservation.reservation_number,
        room: [night.unit?.code, night.unit_type.name].filter(Boolean).join(' · '),
        rate_amount: Number(night.rate_amount).toFixed(2),
        reason: item ? 'voided' : 'not_posted',
      });
    }
    const toRow = (r: (typeof pending)[number]): NightAuditReservationRow => ({
      id: r.id,
      reservation_number: r.reservation_number,
      guest_name: guestName(r.customer),
    });
    return {
      business_date,
      rooms_total,
      rooms_occupied: nights.length,
      nights_posted,
      room_revenue: (revenueCents / 100).toFixed(2),
      no_shows: noShows.map(toRow),
      pending_arrivals: pending.map(toRow),
      discrepancies,
    };
  }

  /** Store date and current business day (before `night_audit_time` it is yesterday). */
  private clock(): Promise<{ today: string; business_date: string }> {
    return lodgingBusinessDate(this.prisma, this.requireStoreId());
  }

  private findAudit(business_date: string) {
    return this.prisma.lodging_night_audits.findFirst({
      where: { business_date: dateOnlyToDb(business_date) },
    });
  }

  private async userNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
    const wanted = [...new Set(ids.filter((id): id is number => !!id))];
    if (wanted.length === 0) return new Map();
    const users = await this.prisma.users.findMany({
      where: { id: { in: wanted } },
      select: { id: true, first_name: true, last_name: true },
    });
    return new Map(users.map((u) => [u.id, guestName(u)]));
  }

  private alreadyClosed(business_date: string) {
    return new VendixHttpException(
      ErrorCodes.LODGING_NIGHT_AUDIT_CLOSED_001,
      `El día ${business_date} ya está cerrado`,
    );
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }
}

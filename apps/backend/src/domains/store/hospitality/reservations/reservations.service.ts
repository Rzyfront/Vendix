import { Injectable } from '@nestjs/common';
import { lodging_reservation_status_enum, Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  localDateString,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import {
  CreateReservationDto,
  ReservationQueryDto,
  ReservationQuoteDto,
} from './dto';
import { LodgingAvailabilityService } from './lodging-availability.service';
import { DepositRetainedEvent, LodgingDepositsService } from './deposits/deposits.service';
import { dateOnlyToDb, formatShortDate, stayNights } from './stay-dates';
import { lodgingBusinessDate } from './folio/folio-nights';
import { loadPlanPricing, PlanTerms } from '../rates/rate-plans.service';
import {
  asPolicySnapshot,
  combinePenalties,
  depositRequired,
  hoursBeforeCheckIn,
  Penalty,
  PenaltyEvent,
  roomPenalty,
} from '../rates/lodging-cancellation-penalty';
import { PricedNight, resolveNightRates, sumNights } from '../rates/lodging-rate-resolver';
import { restrictionViolations } from '../rates/lodging-restriction-validator';
import {
  assertCanOverrideRestrictions,
  loadStayRestrictions,
} from '../rates/restrictions.service';
import {
  canTransition,
  NIGHT_HOLDING_STATUSES,
  statusesThatCanReach,
} from './reservation-status';

type ReservationStatus = lodging_reservation_status_enum;

/**
 * Sales of a store queue on one lock: give a waiting sale room to get it
 * instead of failing at Prisma's 5 s default.
 */
const SALE_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/** Prefix of the per-store reservation sequence: H-0001, H-0002… */
export const RESERVATION_NUMBER_PREFIX = 'H-';

/** Next number of the store sequence after `last` (null = first). */
export function nextReservationNumber(last: string | null | undefined): string {
  const current = Number(last?.match(/(\d+)$/)?.[1] ?? 0);
  return `${RESERVATION_NUMBER_PREFIX}${String(current + 1).padStart(4, '0')}`;
}

const RESERVATION_INCLUDE = {
  customer: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
    },
  },
  rooms: {
    include: {
      unit_type: { select: { id: true, name: true } },
      unit: { select: { id: true, code: true } },
      rate_plan: { select: { id: true, name: true } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.lodging_reservationsInclude;

const RESERVATION_DETAIL_INCLUDE = {
  ...RESERVATION_INCLUDE,
  // H3.1 — prefills the holder in the guest register. Identity documents
  // only in the detail, never in the list (Ley 1581).
  customer: {
    select: {
      ...RESERVATION_INCLUDE.customer.select,
      document_type: true,
      document_number: true,
    },
  },
  // H2.1 — sold nights with their price snapshot, for the per-night breakdown.
  rooms: {
    include: {
      ...RESERVATION_INCLUDE.rooms.include,
      nights: {
        where: { is_active: true },
        select: { night_date: true, rate_amount: true },
        orderBy: { night_date: 'asc' },
      },
    },
    orderBy: { id: 'asc' },
  },
  events: {
    include: { user: { select: { id: true, first_name: true, last_name: true } } },
    orderBy: { id: 'asc' },
  },
  // H3.2 — folio opened at check-in, with the balance of its draft order.
  folio: {
    select: {
      id: true,
      status: true,
      opened_at: true,
      closed_at: true,
      order: { select: { id: true, order_number: true, grand_total: true } },
    },
  },
  // H6.6 — direct payments made online with the booking engine.
  online_payments: {
    select: { id: true, amount: true, applied_amount: true, status: true, paid_at: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.lodging_reservationsInclude;

/** H6.6 — a web booking: held as tentative until paid or expired. */
export interface ReservationHold {
  expires_at: Date;
  /** History line of the creation ("Reserva web pendiente de pago"). */
  reason: string;
}

/** Reason stored when the no-show job moves an overdue arrival. */
export const AUTO_NO_SHOW_REASON = 'Llegada vencida';

interface SellableType {
  id: number;
  name: string;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  nightly_rate: Prisma.Decimal;
}

/** Price of one room for the stay: its plan (null = base) and every night. */
interface PricedStay {
  rate_plan: { id: number; name: string } | null;
  nights: PricedNight[];
  total: Prisma.Decimal;
  /** H2.4 — policy and deposit of the plan (none without a plan). */
  terms: PlanTerms;
}

/** H2.4 — a room sold without a plan has no policy and asks no deposit. */
const NO_TERMS: PlanTerms = { policy: null, deposit_percent: new Prisma.Decimal(0) };

/** Check-in time used for the penalty windows when the store has none. */
const DEFAULT_CHECK_IN_TIME = '15:00';

/** H2.4 — the status a penalty is computed for. */
const PENALTY_EVENTS: Partial<Record<ReservationStatus, PenaltyEvent>> = {
  cancelled: 'cancel',
  no_show: 'no_show',
};

interface PenaltyTiming {
  timezone: string;
  check_in_time: string;
}

type PenaltyClient = Pick<Prisma.TransactionClient, 'lodging_reservations'>;

/**
 * Hospitality Suite (H1.1/H1.5) — nightly reservations of one or more rooms.
 *
 * Every sold night is a `lodging_room_nights` row of the type; availability
 * counts them. Sales of a store are serialized by a transaction-scoped
 * advisory lock taken before counting, so two desks cannot both sell the last
 * room. Each night takes its rate plan price for its weekday (H2.1), or the
 * room type base price without a plan; the price is snapshotted per night.
 */
@Injectable()
export class LodgingReservationsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly availability: LodgingAvailabilityService,
    private readonly deposits: LodgingDepositsService,
  ) {}

  /** Search by guest/number, status and stay dates, newest first. */
  async findAll(query: ReservationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.lodging_reservationsWhereInput = {};
    if (query.status) where.status = query.status;
    // A stay overlaps the range when it arrives before the range ends and
    // leaves after it starts (departure night is not occupied).
    if (query.date_to) where.arrival_date = { lte: dateOnlyToDb(query.date_to) };
    if (query.date_from) where.departure_date = { gt: dateOnlyToDb(query.date_from) };
    if (query.search) {
      const contains = { contains: query.search, mode: 'insensitive' as const };
      const terms = query.search.split(/\s+/).filter(Boolean);
      where.OR = [
        { reservation_number: contains },
        { customer: { email: contains } },
        { customer: { phone: contains } },
        // "Juan Pérez": every word must match the first or last name.
        {
          AND: terms.map((term) => ({
            customer: {
              OR: [
                { first_name: { contains: term, mode: 'insensitive' as const } },
                { last_name: { contains: term, mode: 'insensitive' as const } },
              ],
            },
          })),
        },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.lodging_reservations.findMany({
        where,
        include: RESERVATION_INCLUDE,
        orderBy: [{ id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.lodging_reservations.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /** Today's front desk numbers, in the store's civil date. */
  async stats() {
    const store_id = this.requireStoreId();
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = dateOnlyToDb(localDateString(new Date(), timezone));
    const [arrivals_today, in_house, units, occupied] = await Promise.all([
      this.prisma.lodging_reservations.count({
        where: { arrival_date: today, status: { in: ['confirmed', 'checked_in'] } },
      }),
      this.prisma.lodging_reservations.count({ where: { status: 'checked_in' } }),
      this.prisma.lodging_units.count({ where: { is_active: true } }),
      this.prisma.lodging_room_nights.count({ where: { night_date: today, is_active: true } }),
    ]);
    return {
      arrivals_today,
      in_house,
      occupied_tonight: occupied,
      active_units: units,
      occupancy_percent: units > 0 ? Math.round((occupied / units) * 100) : 0,
    };
  }

  async findOne(id: number) {
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id },
      include: RESERVATION_DETAIL_INCLUDE,
    });
    if (!reservation) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_FIND_001);
    }
    // H2.4 — deposit asked for the rooms still sold ("Depósito pendiente: 30 %").
    const deposit = depositRequired(
      reservation.rooms
        .filter((room) => !room.cancelled_at)
        .map((room) => ({
          deposit_percent: new Prisma.Decimal(room.deposit_percent ?? 0),
          total: new Prisma.Decimal(room.total_amount),
        })),
    );
    return { ...reservation, deposit };
  }

  /**
   * H2.4 — what cancelling now would cost under each room's policy snapshot,
   * so the desk sees "Penalidad: $250.000 (1 noche)" before confirming.
   */
  async cancellationQuote(id: number) {
    const store_id = this.requireStoreId();
    await this.findOne(id);
    const timing = await this.loadPenaltyTiming(store_id);
    const penalty = await this.computePenalty(this.prisma, id, store_id, 'cancel', timing, new Date());
    return {
      penalty_amount: penalty ? penalty.amount.toFixed(2) : null,
      penalty_detail: penalty?.detail ?? null,
      // H3.5 — "retenido $225.000 · por cobrar $25.000" / "por devolver".
      ...(await this.deposits.quoteSettlement(id, penalty?.amount ?? null)),
    };
  }

  /** Cancels a reservation and frees its nights for sale. */
  async cancel(id: number, reason: string) {
    return this.transition(id, 'cancelled', reason);
  }

  /** Marks a guest that did not arrive; allowed from the arrival day on. */
  async markNoShow(id: number, reason?: string) {
    const store_id = this.requireStoreId();
    const reservation = await this.findOne(id);
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = localDateString(new Date(), timezone);
    if (
      canTransition(reservation.status, 'no_show') &&
      reservation.arrival_date.toISOString().slice(0, 10) > today
    ) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_NO_SHOW_001);
    }
    return this.transition(id, 'no_show', reason || null);
  }

  /**
   * Moves the store's confirmed reservations that arrive before
   * `arrivalCutoff` (exclusive) to no-show. Used by the no-show job inside
   * the store context, and by the night audit close (H7.1) with its own
   * reason and user. Returns how many moved.
   */
  async autoNoShow(
    arrivalCutoff: string,
    reason: string = AUTO_NO_SHOW_REASON,
    user_id: number | null = null,
  ): Promise<number> {
    const overdue = await this.prisma.lodging_reservations.findMany({
      where: { status: 'confirmed', arrival_date: { lt: dateOnlyToDb(arrivalCutoff) } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 200,
    });
    let moved = 0;
    for (const { id } of overdue) {
      if (await this.applyTransition(id, 'no_show', reason, user_id)) moved += 1;
    }
    return moved;
  }

  /**
   * H6.6 — the online payment of a web hold arrived: tentative → confirmed.
   * False when the hold is no longer tentative (expired or cancelled).
   */
  async confirmHold(id: number, reason: string): Promise<boolean> {
    return this.applyTransition(id, 'confirmed', reason, null, { from: ['tentative'] });
  }

  /**
   * H6.6 — releases an unpaid web hold (expired, or replaced by a new one of
   * the same guest): tentative → cancelled, nights freed, no penalty.
   */
  async releaseHold(id: number, reason: string): Promise<boolean> {
    return this.applyTransition(id, 'cancelled', reason, null, { from: ['tentative'], penalty: false });
  }

  /** Validated status change with history; throws on an invalid one. */
  private async transition(id: number, to: ReservationStatus, reason: string | null) {
    const user_id = RequestContextService.getContext()?.user_id ?? null;
    const reservation = await this.findOne(id);
    if (!canTransition(reservation.status, to)) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_RESERVATION_TRANSITION_001,
        `No se puede pasar una reserva ${STATUS_LABELS[reservation.status]} a ${STATUS_LABELS[to]}`,
      );
    }
    const changed = await this.applyTransition(id, to, reason, user_id);
    if (!changed) {
      // Someone else (desk or job) changed it first: report its real status.
      const current = await this.findOne(id);
      throw new VendixHttpException(
        ErrorCodes.LODGING_RESERVATION_TRANSITION_001,
        `La reserva ya está ${STATUS_LABELS[current.status]}`,
      );
    }
    return this.findOne(id);
  }

  /**
   * Atomic status change: only applies while the reservation is still in a
   * status that can reach `to`, so the desk and the job never both win.
   * Leaving a night-holding status frees the nights (`is_active=false`, never
   * deleted). Returns false when the reservation was no longer eligible.
   */
  private async applyTransition(
    id: number,
    to: ReservationStatus,
    reason: string | null,
    user_id: number | null,
    options: { from?: ReservationStatus[]; penalty?: boolean } = {},
  ): Promise<boolean> {
    const from = options.from ?? statusesThatCanReach(to);
    const now = new Date();
    // H6.6 — an unpaid web hold that expires owes no penalty.
    const event = options.penalty === false ? undefined : PENALTY_EVENTS[to];
    const timing = event ? await this.loadPenaltyTiming(this.requireStoreId()) : null;
    let retained: DepositRetainedEvent | null = null;
    let cancelledLinks: number[] = [];
    const changed = await this.prisma.$transaction(async (tx) => {
      const current = await tx.lodging_reservations.findFirst({
        where: { id, status: { in: from } },
        select: { id: true, store_id: true, status: true, reservation_number: true, customer_id: true },
      });
      if (!current) return false;
      const updated = await tx.lodging_reservations.updateMany({
        where: { id, status: current.status },
        // H6.6 — leaving `tentative` ends the web hold.
        data: { status: to, updated_at: now, hold_expires_at: null },
      });
      if (updated.count !== 1) return false;
      if (event && timing) {
        // H2.4 — computed on the nights still sold, before they are freed.
        const penalty = await this.computePenalty(tx, id, current.store_id, event, timing, now);
        if (penalty) {
          await tx.lodging_reservations.update({
            where: { id },
            data: {
              cancellation_penalty_amount: penalty.amount,
              cancellation_penalty_detail: penalty.detail.slice(0, 200),
            },
          });
          // H3.5 — the deposit held covers the penalty first.
          retained = await this.deposits.retainInTx(tx, {
            store_id: current.store_id,
            reservation_id: id,
            reservation_number: current.reservation_number,
            customer_id: current.customer_id,
            penalty: penalty.amount,
            user_id,
          });
        }
      }
      // H3.5 — a Wompi link still pending is not collected after the stay ends.
      if (to === 'cancelled' || to === 'no_show') {
        cancelledLinks = await this.deposits.cancelPendingLinksInTx(tx, id);
      }
      if (
        NIGHT_HOLDING_STATUSES.includes(current.status) &&
        !NIGHT_HOLDING_STATUSES.includes(to)
      ) {
        await tx.lodging_room_nights.updateMany({
          where: { is_active: true, reservation_room: { reservation_id: id } },
          data: { is_active: false, updated_at: now },
        });
      }
      await tx.lodging_reservation_events.create({
        data: {
          store_id: current.store_id,
          reservation_id: id,
          from_status: current.status,
          to_status: to,
          reason,
          user_id,
        },
      });
      return true;
    });
    if (changed) {
      this.deposits.announceRetained(retained);
      await this.deposits.deactivateLinks(cancelledLinks);
    }
    return changed;
  }

  /** A stay cannot start before the store's business day (it would no-show at once). */
  private async assertArrivalNotPast(store_id: number, arrival_date: string) {
    const { business_date } = await lodgingBusinessDate(this.prisma, store_id);
    if (arrival_date < business_date) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_DATES_003);
    }
  }

  /** Store time zone and check-in time: the penalty windows count to it. */
  private async loadPenaltyTiming(store_id: number): Promise<PenaltyTiming> {
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    const settings = row?.settings as { hospitality?: { check_in_time?: string } } | null;
    return { timezone, check_in_time: settings?.hospitality?.check_in_time || DEFAULT_CHECK_IN_TIME };
  }

  /**
   * Penalty of the rooms still sold, each with its own policy snapshot,
   * nights (in stay order) and arrival. Null = free.
   */
  private async computePenalty(
    client: PenaltyClient,
    reservation_id: number,
    store_id: number,
    event: PenaltyEvent,
    timing: PenaltyTiming,
    now: Date,
  ): Promise<Penalty | null> {
    const reservation = await client.lodging_reservations.findFirst({
      where: { id: reservation_id, store_id },
      select: {
        rooms: {
          where: { cancelled_at: null },
          select: {
            arrival_date: true,
            total_amount: true,
            cancellation_policy_snapshot: true,
            nights: {
              where: { is_active: true },
              select: { rate_amount: true },
              orderBy: { night_date: 'asc' },
            },
          },
        },
      },
    });
    if (!reservation) return null;
    return combinePenalties(
      reservation.rooms.map((room) =>
        roomPenalty(
          {
            policy: asPolicySnapshot(room.cancellation_policy_snapshot),
            nights: room.nights.map((night) => new Prisma.Decimal(night.rate_amount)),
            total: new Prisma.Decimal(room.total_amount),
          },
          hoursBeforeCheckIn(
            room.arrival_date.toISOString().slice(0, 10),
            timing.check_in_time,
            timing.timezone,
            now,
          ),
          event,
        ),
      ),
    );
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }

  /**
   * "2 disponibles · 3 noches · $750.000" before confirming. `units` and
   * `sold` let the form warn when the sale goes into overbooking (H1.6).
   */
  async quote(dto: ReservationQuoteDto) {
    const store_id = this.requireStoreId();
    const nights = stayNights(dto.arrival_date, dto.departure_date);
    await this.assertArrivalNotPast(store_id, dto.arrival_date);
    const unitType = await this.loadSellableType(dto.unit_type_id);
    assertCapacity(unitType, dto.adults, dto.children ?? 0);
    const priced = await this.priceStay(store_id, unitType, dto.rate_plan_id, nights);
    // H2.3 — what the stay breaks, so the form shows it before confirming.
    const restrictions = restrictionViolations(
      { arrival_date: dto.arrival_date, departure_date: dto.departure_date, nights, unit_type: unitType },
      await loadStayRestrictions(this.prisma, dto.arrival_date, dto.departure_date),
    );
    const inventory = await this.availability.getInventory(
      unitType.id,
      dto.arrival_date,
      dto.departure_date,
      undefined,
      undefined,
      dto.customer_id,
    );
    return {
      unit_type: { id: unitType.id, name: unitType.name },
      available: inventory.available,
      units: inventory.units,
      sold: inventory.sold,
      // H2.5 — rooms held for other customers' allotments (not for sale).
      held: inventory.held,
      overbooking_allowance: inventory.overbooking_allowance,
      nights: nights.length,
      rate_plan: priced.rate_plan,
      night_rates: priced.nights.map((n) => ({
        night_date: n.night_date,
        rate_amount: n.rate_amount.toFixed(2),
      })),
      total_amount: priced.total.toFixed(2),
      // H2.4 — what the guest agrees to when booking.
      cancellation_policy: priced.terms.policy,
      deposit_percent: priced.terms.deposit_percent.toString(),
      restrictions,
    };
  }

  /**
   * Sells every room of the reservation in one transaction (H1.5): if one
   * type lacks rooms nothing is created and the error names that type.
   */
  async create(dto: CreateReservationDto, hold?: ReservationHold) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const nights = stayNights(dto.arrival_date, dto.departure_date);
    await this.assertArrivalNotPast(store_id, dto.arrival_date);
    // Types in id order, so checks (and the type a shortage names) are stable.
    const typeIds = [...new Set(dto.rooms.map((r) => r.unit_type_id))].sort((a, b) => a - b);
    const types = new Map<number, SellableType>();
    for (const typeId of typeIds) {
      types.set(typeId, await this.loadSellableType(typeId));
    }
    const lines: Array<PricedStay & { unitType: SellableType; adults: number; children: number }> = [];
    for (const room of dto.rooms) {
      const unitType = types.get(room.unit_type_id)!;
      const children = room.children ?? 0;
      assertCapacity(unitType, room.adults, children);
      const priced = await this.priceStay(store_id, unitType, room.rate_plan_id, nights);
      lines.push({ unitType, adults: room.adults, children, ...priced });
    }
    await this.assertCustomerInStore(store_id, dto.customer_id);
    const overrideReason = await this.checkRestrictions(dto, nights, [...types.values()]);

    const total = lines.reduce((sum, line) => sum.add(line.total), new Prisma.Decimal(0));
    const arrival = dateOnlyToDb(dto.arrival_date);
    const departure = dateOnlyToDb(dto.departure_date);
    const now = new Date();

    const id = await this.prisma.$transaction(async (tx) => {
      // Serializes every sale of the store: availability and the sequence
      // number are read and written while no other sale can run. One lock
      // for all the types of the reservation, so they cannot deadlock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_reservations:${store_id}`}))`;

      for (const typeId of typeIds) {
        const requested = lines.filter((line) => line.unitType.id === typeId).length;
        const available = await this.availability.countAvailable(
          typeId,
          dto.arrival_date,
          dto.departure_date,
          tx,
          undefined,
          // H2.5 — an agency or company sells from its own allotment.
          dto.customer_id,
        );
        if (available < requested) {
          const left = available > 0 ? ` (quedan ${available})` : '';
          throw new VendixHttpException(
            ErrorCodes.LODGING_RESERVATION_AVAILABILITY_001,
            `Sin disponibilidad de ${types.get(typeId)!.name} para el ${formatShortDate(dto.arrival_date)} al ${formatShortDate(dto.departure_date)}${left}`,
          );
        }
      }

      const last = await tx.lodging_reservations.findFirst({
        where: { store_id },
        orderBy: { id: 'desc' },
        select: { reservation_number: true },
      });
      const reservation = await tx.lodging_reservations.create({
        data: {
          store_id,
          reservation_number: nextReservationNumber(last?.reservation_number),
          // H6.6 — a web booking holds its nights as tentative until paid.
          status: hold ? 'tentative' : 'confirmed',
          hold_expires_at: hold?.expires_at ?? null,
          arrival_date: arrival,
          departure_date: departure,
          customer_id: dto.customer_id,
          total_amount: total,
          notes: dto.notes || null,
          // The web guest is the customer, not a staff user.
          created_by_user_id: hold ? null : (context?.user_id ?? null),
          updated_at: now,
        },
      });
      for (const line of lines) {
        const room = await tx.lodging_reservation_rooms.create({
          data: {
            store_id,
            reservation_id: reservation.id,
            unit_type_id: line.unitType.id,
            arrival_date: arrival,
            departure_date: departure,
            adults: line.adults,
            children: line.children,
            rate_plan_id: line.rate_plan?.id ?? null,
            // H2.4 — the policy and deposit in force when booking.
            cancellation_policy_snapshot: line.terms.policy
              ? (line.terms.policy as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            deposit_percent: line.terms.deposit_percent,
            total_amount: line.total,
            updated_at: now,
          },
        });
        await tx.lodging_room_nights.createMany({
          data: line.nights.map((night) => ({
            store_id,
            reservation_room_id: room.id,
            unit_type_id: line.unitType.id,
            night_date: dateOnlyToDb(night.night_date),
            rate_amount: night.rate_amount,
            updated_at: now,
          })),
        });
      }
      await tx.lodging_reservation_events.create({
        data: {
          store_id,
          reservation_id: reservation.id,
          from_status: null,
          to_status: hold ? 'tentative' : 'confirmed',
          ...(overrideReason || hold ? { reason: hold?.reason ?? overrideReason } : {}),
          user_id: hold ? null : (context?.user_id ?? null),
        },
      });
      return reservation.id;
    }, SALE_TX_OPTIONS);

    return this.findOne(id);
  }

  /**
   * Cancels one room of a multi-room reservation (H1.5): frees its nights,
   * keeps the other rooms active and recomputes the header total and dates.
   * The last active room cannot be cancelled alone: cancel the reservation.
   */
  async cancelRoom(room_id: number, reason: string) {
    const store_id = this.requireStoreId();
    const user_id = RequestContextService.getContext()?.user_id ?? null;
    const now = new Date();
    const reservationId = await this.prisma.$transaction(async (tx) => {
      // Inside `$transaction` the client is not store-scoped: name the store.
      const room = await tx.lodging_reservation_rooms.findFirst({
        where: { id: room_id, store_id },
        select: { reservation_id: true },
      });
      if (!room) {
        throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_ROOM_FIND_001);
      }
      // Serializes with a room change, a cancellation or a no-show of the
      // same reservation.
      await tx.$executeRaw`SELECT id FROM lodging_reservations WHERE id = ${room.reservation_id} AND store_id = ${store_id} FOR UPDATE`;
      const reservation = await tx.lodging_reservations.findFirst({
        where: { id: room.reservation_id, store_id },
        select: {
          id: true,
          status: true,
          rooms: {
            where: { cancelled_at: null },
            select: {
              id: true,
              unit_type: { select: { name: true } },
              unit: { select: { code: true } },
            },
          },
        },
      });
      if (!reservation || !canTransition(reservation.status, 'cancelled')) {
        throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_ROOM_STATUS_001);
      }
      const target = reservation.rooms.find((r) => r.id === room_id);
      if (!target) {
        throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_ROOM_CANCELLED_001);
      }
      if (reservation.rooms.length < 2) {
        throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_ROOM_LAST_001);
      }

      await tx.lodging_reservation_rooms.update({
        where: { id: room_id },
        data: { cancelled_at: now, updated_at: now },
      });
      await tx.lodging_room_nights.updateMany({
        where: { reservation_room_id: room_id, is_active: true },
        data: { is_active: false, updated_at: now },
      });
      // The header spans its active rooms and sums their totals.
      const active = await tx.lodging_reservation_rooms.aggregate({
        where: { reservation_id: reservation.id, cancelled_at: null },
        _min: { arrival_date: true },
        _max: { departure_date: true },
        _sum: { total_amount: true },
      });
      await tx.lodging_reservations.update({
        where: { id: reservation.id },
        data: {
          ...(active._min.arrival_date ? { arrival_date: active._min.arrival_date } : {}),
          ...(active._max.departure_date ? { departure_date: active._max.departure_date } : {}),
          total_amount: active._sum.total_amount ?? new Prisma.Decimal(0),
          updated_at: now,
        },
      });
      const label = [target.unit_type.name, target.unit?.code].filter(Boolean).join(' · ');
      await tx.lodging_reservation_events.create({
        data: {
          store_id,
          reservation_id: reservation.id,
          from_status: reservation.status,
          to_status: reservation.status,
          reason: `Habitación cancelada: ${label} — ${reason}`.slice(0, 500),
          user_id,
        },
      });
      return reservation.id;
    }, SALE_TX_OPTIONS);
    return this.findOne(reservationId);
  }

  /**
   * H2.3 — the stay must respect the restrictions of every room type it
   * sells. A user with `rates:write` may force it with a reason; returns the
   * history line for the creation event (null when nothing was forced).
   */
  private async checkRestrictions(
    dto: CreateReservationDto,
    nights: string[],
    types: SellableType[],
  ): Promise<string | null> {
    const rows = await loadStayRestrictions(this.prisma, dto.arrival_date, dto.departure_date);
    const violations = [
      ...new Set(
        types.flatMap((unit_type) =>
          restrictionViolations(
            { arrival_date: dto.arrival_date, departure_date: dto.departure_date, nights, unit_type },
            rows,
          ),
        ),
      ),
    ];
    if (violations.length === 0) return null;
    if (!dto.restriction_override_reason) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESTRICTION_STAY_001, violations.join('. '));
    }
    assertCanOverrideRestrictions();
    return `Restricciones forzadas: ${violations.join('; ')} — ${dto.restriction_override_reason}`.slice(0, 500);
  }

  /**
   * Prices every night of a room: with a plan, each night takes the plan's
   * price for its weekday; without one, the room type base price.
   */
  private async priceStay(
    store_id: number,
    unitType: SellableType,
    rate_plan_id: number | undefined,
    nights: string[],
  ): Promise<PricedStay> {
    if (rate_plan_id == null) {
      const base = nights.map((night_date) => ({ night_date, rate_amount: unitType.nightly_rate }));
      return { rate_plan: null, nights: base, total: sumNights(base), terms: NO_TERMS };
    }
    const { plan, prices, terms } = await loadPlanPricing(
      this.prisma,
      store_id,
      rate_plan_id,
      unitType,
    );
    // A plan with a base price prices every night.
    const priced = resolveNightRates(nights, prices)!;
    return { rate_plan: plan, nights: priced, total: sumNights(priced), terms };
  }

  private async loadSellableType(unit_type_id: number): Promise<SellableType> {
    const unitType = await this.prisma.lodging_unit_types.findFirst({
      where: { id: unit_type_id },
      select: {
        id: true,
        name: true,
        is_active: true,
        max_adults: true,
        max_children: true,
        max_occupancy: true,
        product: { select: { base_price: true } },
      },
    });
    if (!unitType) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_FIND_001);
    }
    if (!unitType.is_active) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_TYPE_001);
    }
    return {
      id: unitType.id,
      name: unitType.name,
      max_adults: unitType.max_adults,
      max_children: unitType.max_children,
      max_occupancy: unitType.max_occupancy,
      nightly_rate: new Prisma.Decimal(unitType.product.base_price),
    };
  }

  /** `users` is not store-scoped: membership is checked explicitly. */
  private async assertCustomerInStore(store_id: number, customer_id: number) {
    const customer = await this.prisma.users.findFirst({
      where: { id: customer_id, store_users: { some: { store_id } } },
      select: { id: true },
    });
    if (!customer) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_CUSTOMER_001);
    }
  }
}

/** Spanish status names for transition messages. */
const STATUS_LABELS: Record<ReservationStatus, string> = {
  tentative: 'tentativa',
  confirmed: 'confirmada',
  checked_in: 'en casa',
  checked_out: 'con salida',
  cancelled: 'cancelada',
  no_show: 'no-show',
};

/** Occupancy must fit the room type (adults, children and total). */
export function assertCapacity(
  unitType: Pick<SellableType, 'max_adults' | 'max_children' | 'max_occupancy'>,
  adults: number,
  children: number,
): void {
  if (
    adults > unitType.max_adults ||
    children > unitType.max_children ||
    adults + children > unitType.max_occupancy
  ) {
    throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_CAPACITY_001);
  }
}

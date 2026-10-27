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
import { dateOnlyToDb, formatShortDate, stayNights } from './stay-dates';
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
    select: { id: true, first_name: true, last_name: true, email: true, phone: true },
  },
  rooms: {
    include: {
      unit_type: { select: { id: true, name: true } },
      unit: { select: { id: true, code: true } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.lodging_reservationsInclude;

const RESERVATION_DETAIL_INCLUDE = {
  ...RESERVATION_INCLUDE,
  events: {
    include: { user: { select: { id: true, first_name: true, last_name: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.lodging_reservationsInclude;

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

/**
 * Hospitality Suite (H1.1) — nightly reservations of one room type.
 *
 * Every sold night is a `lodging_room_nights` row of the type; availability
 * counts them. Sales of a store are serialized by a transaction-scoped
 * advisory lock taken before counting, so two desks cannot both sell the last
 * room. Price = room type base price × nights (rate plans arrive in H2.1).
 */
@Injectable()
export class LodgingReservationsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly availability: LodgingAvailabilityService,
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
    return reservation;
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
   * the store context. Returns how many moved.
   */
  async autoNoShow(arrivalCutoff: string): Promise<number> {
    const overdue = await this.prisma.lodging_reservations.findMany({
      where: { status: 'confirmed', arrival_date: { lt: dateOnlyToDb(arrivalCutoff) } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 200,
    });
    let moved = 0;
    for (const { id } of overdue) {
      if (await this.applyTransition(id, 'no_show', AUTO_NO_SHOW_REASON, null)) moved += 1;
    }
    return moved;
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
  ): Promise<boolean> {
    const from = statusesThatCanReach(to);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.lodging_reservations.findFirst({
        where: { id, status: { in: from } },
        select: { id: true, store_id: true, status: true },
      });
      if (!current) return false;
      const updated = await tx.lodging_reservations.updateMany({
        where: { id, status: current.status },
        data: { status: to, updated_at: now },
      });
      if (updated.count !== 1) return false;
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
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }

  /** "2 disponibles · 3 noches · $750.000" before confirming. */
  async quote(dto: ReservationQuoteDto) {
    const nights = stayNights(dto.arrival_date, dto.departure_date);
    const unitType = await this.loadSellableType(dto.unit_type_id);
    assertCapacity(unitType, dto.adults, dto.children ?? 0);
    const available = await this.availability.countAvailable(
      unitType.id,
      dto.arrival_date,
      dto.departure_date,
    );
    return {
      unit_type: { id: unitType.id, name: unitType.name },
      available,
      nights: nights.length,
      nightly_rate: unitType.nightly_rate.toFixed(2),
      total_amount: unitType.nightly_rate.mul(nights.length).toFixed(2),
    };
  }

  async create(dto: CreateReservationDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const children = dto.children ?? 0;
    const nights = stayNights(dto.arrival_date, dto.departure_date);
    const unitType = await this.loadSellableType(dto.unit_type_id);
    assertCapacity(unitType, dto.adults, children);
    await this.assertCustomerInStore(store_id, dto.customer_id);

    const rate = unitType.nightly_rate;
    const total = rate.mul(nights.length);
    const arrival = dateOnlyToDb(dto.arrival_date);
    const departure = dateOnlyToDb(dto.departure_date);
    const now = new Date();

    const id = await this.prisma.$transaction(async (tx) => {
      // Serializes every sale of the store: availability and the sequence
      // number are read and written while no other sale can run.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_reservations:${store_id}`}))`;

      const available = await this.availability.countAvailable(
        unitType.id,
        dto.arrival_date,
        dto.departure_date,
        tx,
      );
      if (available < 1) {
        throw new VendixHttpException(
          ErrorCodes.LODGING_RESERVATION_AVAILABILITY_001,
          `Sin disponibilidad de ${unitType.name} para el ${formatShortDate(dto.arrival_date)} al ${formatShortDate(dto.departure_date)}`,
        );
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
          status: 'confirmed',
          arrival_date: arrival,
          departure_date: departure,
          customer_id: dto.customer_id,
          total_amount: total,
          notes: dto.notes || null,
          created_by_user_id: context?.user_id ?? null,
          updated_at: now,
        },
      });
      const room = await tx.lodging_reservation_rooms.create({
        data: {
          store_id,
          reservation_id: reservation.id,
          unit_type_id: unitType.id,
          arrival_date: arrival,
          departure_date: departure,
          adults: dto.adults,
          children,
          total_amount: total,
          updated_at: now,
        },
      });
      await tx.lodging_room_nights.createMany({
        data: nights.map((night) => ({
          store_id,
          reservation_room_id: room.id,
          unit_type_id: unitType.id,
          night_date: dateOnlyToDb(night),
          rate_amount: rate,
          updated_at: now,
        })),
      });
      await tx.lodging_reservation_events.create({
        data: {
          store_id,
          reservation_id: reservation.id,
          from_status: null,
          to_status: 'confirmed',
          user_id: context?.user_id ?? null,
        },
      });
      return reservation.id;
    }, SALE_TX_OPTIONS);

    return this.findOne(id);
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

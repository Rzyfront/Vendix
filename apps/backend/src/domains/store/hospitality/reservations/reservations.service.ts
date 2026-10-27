import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateReservationDto, ReservationQuoteDto } from './dto';
import { LodgingAvailabilityService } from './lodging-availability.service';
import { dateOnlyToDb, formatShortDate, stayNights } from './stay-dates';

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
    include: { unit_type: { select: { id: true, name: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.lodging_reservationsInclude;

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

  async findAll() {
    // H1.2 adds search, filters and paging.
    return this.prisma.lodging_reservations.findMany({
      include: RESERVATION_INCLUDE,
      orderBy: [{ id: 'desc' }],
      take: 100,
    });
  }

  async findOne(id: number) {
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_FIND_001);
    }
    return reservation;
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

import { Injectable } from '@nestjs/common';
import { lodging_reservation_status_enum, Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RoomChangeDto } from './dto';
import { LodgingAvailabilityService, LodgingInventoryClient } from './lodging-availability.service';
import { assertCapacity } from './reservations.service';
import { dateOnlyToDb, formatShortDate, stayNights } from './stay-dates';
import { NIGHT_HOLDING_STATUSES } from './reservation-status';
import { loadPlanPricing } from '../rates/rate-plans.service';
import { resolveNightRate } from '../rates/lodging-rate-resolver';

/** Same queue and limits as a sale: changes wait on the store's sale lock. */
const CHANGE_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/** Housekeeping states that take a room out of sale. */
const UNSELLABLE_HOUSEKEEPING = ['out_of_order', 'out_of_service'];

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

type ChangeClient = LodgingInventoryClient &
  Pick<
    StorePrismaService,
    'lodging_reservation_rooms' | 'lodging_unit_types' | 'lodging_rate_plans' | 'lodging_rate_prices'
  >;

/** Price of a night of the stay (rate plan by weekday, or base price). */
export type NightRateFn = (night_date: string) => Prisma.Decimal;

export interface NightRate {
  night_date: string;
  rate_amount: Prisma.Decimal;
}

/**
 * Nights of a changed stay. Kept nights keep their sold rate unless the room
 * type changes (then every night is repriced); added nights take
 * `rateFor(night)`. Pure, so the price recalculation is testable.
 */
export function diffStayNights(
  current: NightRate[],
  nights: string[],
  rateFor: NightRateFn,
  repriceAll: boolean,
) {
  const sold = new Map(current.map((n) => [n.night_date, n.rate_amount]));
  const wanted = new Set(nights);
  const kept = nights.filter((n) => sold.has(n));
  const added = nights.filter((n) => !sold.has(n));
  const removed = current.map((n) => n.night_date).filter((n) => !wanted.has(n));
  const total = nights.reduce(
    (sum, n) => sum.add(repriceAll || !sold.has(n) ? rateFor(n) : sold.get(n)!),
    new Prisma.Decimal(0),
  );
  return { kept, added, removed, total };
}

interface StaySide {
  unit: { id: number; code: string } | null;
  unit_type: { id: number; name: string };
  arrival_date: string;
  departure_date: string;
  nights: number;
  total_amount: string;
}

interface ChangePlan {
  room_id: number;
  reservation_id: number;
  status: lodging_reservation_status_enum;
  rateFor: NightRateFn;
  unit_changed: boolean;
  type_changed: boolean;
  nights: ReturnType<typeof diffStayNights>;
  current: StaySide;
  proposed: StaySide;
}

/**
 * Hospitality Suite (H1.4) — assign a physical room, move a stay to another
 * room and lengthen or shorten it, from the rack or the "Mover" modal.
 *
 * `quote` validates and prices a change without writing (the desk confirms
 * the difference); `apply` repeats the same plan under the store's sale lock
 * and the reservation row lock, then writes it with its history entry. The
 * partial unique index `(unit_id, night_date)` is the last guard: a collision
 * that slips past the check is rejected by the database and translated.
 */
@Injectable()
export class LodgingRoomChangesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly availability: LodgingAvailabilityService,
  ) {}

  async quote(room_id: number, dto: RoomChangeDto) {
    const plan = await this.plan(this.prisma, this.requireStoreId(), room_id, dto);
    return {
      reservation_room_id: plan.room_id,
      reservation_id: plan.reservation_id,
      current: plan.current,
      proposed: plan.proposed,
      difference: plan.nights.total.sub(plan.current.total_amount).toFixed(2),
    };
  }

  /** Applies the change; returns the reservation id. */
  async apply(room_id: number, dto: RoomChangeDto): Promise<number> {
    const store_id = this.requireStoreId();
    const user_id = RequestContextService.getContext()?.user_id ?? null;
    let targetCode: string | null = null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Same lock as a sale: availability and unit checks cannot interleave
        // with another sale or change of the store.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_reservations:${store_id}`}))`;
        const head = await tx.lodging_reservation_rooms.findFirst({
          where: { id: room_id, store_id },
          select: { reservation_id: true },
        });
        if (!head) {
          throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_ROOM_FIND_001);
        }
        // Serializes with a cancellation/no-show of the same reservation.
        await tx.$executeRaw`SELECT id FROM lodging_reservations WHERE id = ${head.reservation_id} AND store_id = ${store_id} FOR UPDATE`;

        const plan = await this.plan(tx, store_id, room_id, dto);
        targetCode = plan.proposed.unit?.code ?? null;
        await this.write(tx, plan, store_id, user_id);
        return plan.reservation_id;
      }, CHANGE_TX_OPTIONS);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new VendixHttpException(
          ErrorCodes.LODGING_RESERVATION_ROOM_CONFLICT_001,
          targetCode ? `La ${targetCode} está ocupada en esas fechas` : undefined,
        );
      }
      throw error;
    }
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }

  /**
   * Validates and prices a change. Every filter names the store: inside
   * `$transaction` the client is not store-scoped.
   */
  private async plan(
    client: ChangeClient,
    store_id: number,
    room_id: number,
    dto: RoomChangeDto,
  ): Promise<ChangePlan> {
    const room = await client.lodging_reservation_rooms.findFirst({
      where: { id: room_id, store_id },
      select: {
        id: true,
        reservation_id: true,
        unit_type_id: true,
        arrival_date: true,
        departure_date: true,
        adults: true,
        children: true,
        total_amount: true,
        rate_plan_id: true,
        unit: { select: { id: true, code: true } },
        unit_type: { select: { id: true, name: true } },
        cancelled_at: true,
        reservation: { select: { status: true } },
        nights: {
          where: { is_active: true },
          select: { night_date: true, rate_amount: true },
          orderBy: { night_date: 'asc' },
        },
      },
    });
    if (!room) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_ROOM_FIND_001);
    }
    if (room.cancelled_at) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_ROOM_CANCELLED_001);
    }
    const status = room.reservation.status;
    if (!NIGHT_HOLDING_STATUSES.includes(status)) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_ROOM_STATUS_001);
    }

    const currentArrival = toDateOnly(room.arrival_date);
    const currentDeparture = toDateOnly(room.departure_date);
    const arrival = dto.arrival_date ?? currentArrival;
    const departure = dto.departure_date ?? currentDeparture;
    if (status === 'checked_in' && arrival !== currentArrival) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_ROOM_ARRIVAL_001);
    }
    const nights = stayNights(arrival, departure);
    const soldNights = new Set(room.nights.map((n) => toDateOnly(n.night_date)));

    let unit = room.unit;
    let unit_type_id = room.unit_type_id;
    if (dto.unit_id != null && dto.unit_id !== room.unit?.id) {
      const target = await client.lodging_units.findFirst({
        where: { id: dto.unit_id, store_id },
        select: { id: true, code: true, unit_type_id: true, is_active: true, housekeeping_status: true },
      });
      if (!target) {
        throw new VendixHttpException(ErrorCodes.LODGING_UNIT_FIND_001);
      }
      if (!target.is_active || UNSELLABLE_HOUSEKEEPING.includes(target.housekeeping_status)) {
        throw new VendixHttpException(
          ErrorCodes.LODGING_RESERVATION_ROOM_UNIT_001,
          `La ${target.code} no está disponible para asignar`,
        );
      }
      unit = { id: target.id, code: target.code };
      unit_type_id = target.unit_type_id;
    }
    const unit_changed = unit?.id !== room.unit?.id;
    const type_changed = unit_type_id !== room.unit_type_id;
    if (!unit_changed && arrival === currentArrival && departure === currentDeparture) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_ROOM_NOCHANGE_001);
    }

    const type = await client.lodging_unit_types.findFirst({
      where: { id: unit_type_id, store_id },
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
    if (!type) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_FIND_001);
    }
    // The room keeps its rate plan (H2.1): repriced and added nights take the
    // plan's price for their weekday, or the type base price without a plan.
    let rateFor: NightRateFn;
    if (room.rate_plan_id != null && (type_changed || nights.some((n) => !soldNights.has(n)))) {
      const { prices } = await loadPlanPricing(client, store_id, room.rate_plan_id, type, true);
      rateFor = (night) => resolveNightRate(night, prices)!;
    } else {
      const base = new Prisma.Decimal(type.product.base_price);
      rateFor = () => base;
    }
    const diff = diffStayNights(
      room.nights.map((n) => ({ night_date: toDateOnly(n.night_date), rate_amount: n.rate_amount })),
      nights,
      rateFor,
      type_changed,
    );

    // Selling the type again (new type or extra nights) needs a free room of it.
    if (type_changed || diff.added.length > 0) {
      if (!type.is_active) {
        throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_TYPE_001);
      }
      if (type_changed) assertCapacity(type, room.adults, room.children);
      const available = await this.availability.countAvailable(
        type.id,
        arrival,
        departure,
        client,
        room.id,
      );
      if (available < 1) {
        throw new VendixHttpException(
          ErrorCodes.LODGING_RESERVATION_AVAILABILITY_001,
          `Sin disponibilidad de ${type.name} para el ${formatShortDate(arrival)} al ${formatShortDate(departure)}`,
        );
      }
    }

    // The physical room must be free on every night of the new stay.
    if (unit) {
      const taken = await client.lodging_room_nights.findFirst({
        where: {
          store_id,
          unit_id: unit.id,
          is_active: true,
          reservation_room_id: { not: room.id },
          night_date: { in: nights.map(dateOnlyToDb) },
        },
        select: { night_date: true },
        orderBy: { night_date: 'asc' },
      });
      if (taken) {
        throw new VendixHttpException(
          ErrorCodes.LODGING_RESERVATION_ROOM_CONFLICT_001,
          `La ${unit.code} está ocupada el ${formatShortDate(toDateOnly(taken.night_date))}`,
        );
      }
    }

    return {
      room_id: room.id,
      reservation_id: room.reservation_id,
      status,
      rateFor,
      unit_changed,
      type_changed,
      nights: diff,
      current: {
        unit: room.unit,
        unit_type: room.unit_type,
        arrival_date: currentArrival,
        departure_date: currentDeparture,
        nights: room.nights.length,
        total_amount: new Prisma.Decimal(room.total_amount).toFixed(2),
      },
      proposed: {
        unit,
        unit_type: { id: type.id, name: type.name },
        arrival_date: arrival,
        departure_date: departure,
        nights: nights.length,
        total_amount: diff.total.toFixed(2),
      },
    };
  }

  private async write(
    tx: Prisma.TransactionClient,
    plan: ChangePlan,
    store_id: number,
    user_id: number | null,
  ): Promise<void> {
    const now = new Date();
    const { proposed, nights } = plan;
    const unit_id = proposed.unit?.id ?? null;
    const unit_type_id = proposed.unit_type.id;

    // Free the dropped nights first, so they never collide on the new room.
    if (nights.removed.length > 0) {
      await tx.lodging_room_nights.updateMany({
        where: {
          reservation_room_id: plan.room_id,
          is_active: true,
          night_date: { in: nights.removed.map(dateOnlyToDb) },
        },
        data: { is_active: false, updated_at: now },
      });
    }
    if (plan.unit_changed || plan.type_changed) {
      await tx.lodging_room_nights.updateMany({
        where: { reservation_room_id: plan.room_id, is_active: true },
        data: { unit_id, unit_type_id, updated_at: now },
      });
    }
    if (plan.type_changed) {
      // Kept nights take the new type's price, grouped by amount.
      const byRate = new Map<string, string[]>();
      for (const night of nights.kept) {
        const key = plan.rateFor(night).toFixed(2);
        byRate.set(key, [...(byRate.get(key) ?? []), night]);
      }
      for (const [rate_amount, dates] of byRate) {
        await tx.lodging_room_nights.updateMany({
          where: {
            reservation_room_id: plan.room_id,
            is_active: true,
            night_date: { in: dates.map(dateOnlyToDb) },
          },
          data: { rate_amount: new Prisma.Decimal(rate_amount), updated_at: now },
        });
      }
    }
    if (nights.added.length > 0) {
      await tx.lodging_room_nights.createMany({
        data: nights.added.map((night) => ({
          store_id,
          reservation_room_id: plan.room_id,
          unit_type_id,
          unit_id,
          night_date: dateOnlyToDb(night),
          rate_amount: plan.rateFor(night),
          updated_at: now,
        })),
      });
    }
    await tx.lodging_reservation_rooms.update({
      where: { id: plan.room_id },
      data: {
        unit_id,
        unit_type_id,
        arrival_date: dateOnlyToDb(proposed.arrival_date),
        departure_date: dateOnlyToDb(proposed.departure_date),
        total_amount: nights.total,
        updated_at: now,
      },
    });
    // The header spans its active rooms and sums their totals.
    const rooms = await tx.lodging_reservation_rooms.aggregate({
      where: { reservation_id: plan.reservation_id, cancelled_at: null },
      _min: { arrival_date: true },
      _max: { departure_date: true },
      _sum: { total_amount: true },
    });
    await tx.lodging_reservations.update({
      where: { id: plan.reservation_id },
      data: {
        arrival_date: rooms._min.arrival_date ?? dateOnlyToDb(proposed.arrival_date),
        departure_date: rooms._max.departure_date ?? dateOnlyToDb(proposed.departure_date),
        total_amount: rooms._sum.total_amount ?? nights.total,
        updated_at: now,
      },
    });
    await tx.lodging_reservation_events.create({
      data: {
        store_id,
        reservation_id: plan.reservation_id,
        from_status: plan.status,
        to_status: plan.status,
        reason: describeChange(plan.current, proposed),
        user_id,
      },
    });
  }
}

/** History line of a change: "Habitación: Sin asignar → 101 · Fechas: …". */
export function describeChange(current: StaySide, proposed: StaySide): string {
  const parts: string[] = [];
  if (current.unit?.id !== proposed.unit?.id) {
    parts.push(`Habitación: ${current.unit?.code ?? 'Sin asignar'} → ${proposed.unit?.code ?? 'Sin asignar'}`);
  }
  if (current.unit_type.id !== proposed.unit_type.id) {
    parts.push(`Tipo: ${current.unit_type.name} → ${proposed.unit_type.name}`);
  }
  if (
    current.arrival_date !== proposed.arrival_date ||
    current.departure_date !== proposed.departure_date
  ) {
    const range = (s: StaySide) =>
      `${formatShortDate(s.arrival_date)} al ${formatShortDate(s.departure_date)} (${s.nights} noches)`;
    parts.push(`Fechas: ${range(current)} → ${range(proposed)}`);
  }
  return parts.join(' · ');
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  localDateString,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb, stayNights } from './stay-dates';
import { allotmentHolds, consumedKey } from './lodging-allotment-holds';
import { UNSELLABLE_HOUSEKEEPING_STATUSES } from '../housekeeping/housekeeping-status';

/** Prisma client or interactive transaction exposing the lodging models. */
export type LodgingInventoryClient = Pick<
  StorePrismaService,
  | 'lodging_unit_types'
  | 'lodging_units'
  | 'lodging_room_nights'
  | 'lodging_allotments'
  | 'lodging_inventory_blocks'
>;

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

/**
 * H5.1 — sellable rooms of a type: active and not out of order/service.
 * Taking a room out of service lowers its type's availability at once.
 */
const sellableUnitsWhere = (unit_type_id: number) => ({
  unit_type_id,
  is_active: true,
  housekeeping_status: { notIn: [...UNSELLABLE_HOUSEKEEPING_STATUSES] },
});

/**
 * H5.1 — sold nights that need a sellable room. A night assigned to a room
 * out of order/service already left the sale with that room, so it is not
 * subtracted a second time from the sellable rooms.
 */
export const NIGHTS_ON_SELLABLE_ROOMS: Prisma.lodging_room_nightsWhereInput = {
  OR: [
    { unit_id: null },
    { unit: { housekeeping_status: { notIn: [...UNSELLABLE_HOUSEKEEPING_STATUSES] } } },
  ],
};

/** `groupBy(['night_date'])` counts → rooms per `YYYY-MM-DD`. */
const countByNight = (rows: { night_date: Date; _count: { _all: number } }[]) =>
  new Map<string, number>(
    rows.map((r) => [toDateOnly(r.night_date), r._count._all]),
  );

/** Inventory of a room type over a stay. */
export interface LodgingTypeInventory {
  /** Active physical rooms of the type. */
  units: number;
  /** Rooms the hotel may sell above `units` (H1.6 overbooking). */
  overbooking_allowance: number;
  /** Most rooms already sold on any night of the stay. */
  sold: number;
  /** Most rooms held for other customers' allotments on a night (H2.5). */
  held: number;
  /** Most sellable rooms blocked for maintenance or owner use on a night (H5.3). */
  blocked: number;
  /**
   * Rooms still for sale: `units + overbooking_allowance` minus the busiest
   * night's sold + held + blocked rooms, never below 0.
   */
  available: number;
}

/**
 * Hospitality Suite (H1.1) — room-type availability per night.
 *
 * Rooms of a type left for a stay = active rooms + overbooking allowance
 * (H1.6) - the most active nights already sold on any night of the stay.
 * Overbooking only widens the type count: the physical room stays unique per
 * night in the database. Pass the transaction client when the count guards a
 * sale, so it runs under the same lock as the insert.
 * `exclude_reservation_room_id` leaves out the nights of a room being changed
 * (H1.4), so it does not compete with itself.
 * H2.5 — unbooked allotment rooms of other customers are not for sale until
 * released; `buyer_customer_id` sells from its own allotment.
 */
@Injectable()
export class LodgingAvailabilityService {
  constructor(private readonly prisma: StorePrismaService) {}

  async countAvailable(
    unit_type_id: number,
    arrival_date: string,
    departure_date: string,
    client: LodgingInventoryClient = this.prisma,
    exclude_reservation_room_id?: number,
    buyer_customer_id?: number,
  ): Promise<number> {
    const inventory = await this.getInventory(
      unit_type_id,
      arrival_date,
      departure_date,
      client,
      exclude_reservation_room_id,
      buyer_customer_id,
    );
    return inventory.available;
  }

  async getInventory(
    unit_type_id: number,
    arrival_date: string,
    departure_date: string,
    client: LodgingInventoryClient = this.prisma,
    exclude_reservation_room_id?: number,
    buyer_customer_id?: number,
  ): Promise<LodgingTypeInventory> {
    const nights = stayNights(arrival_date, departure_date);
    const [type, units, booked, holds, blocks] = await Promise.all([
      client.lodging_unit_types.findFirst({
        where: { id: unit_type_id },
        select: { overbooking_allowance: true },
      }),
      client.lodging_units.count({ where: sellableUnitsWhere(unit_type_id) }),
      client.lodging_room_nights.groupBy({
        by: ['night_date'],
        where: {
          unit_type_id,
          is_active: true,
          ...NIGHTS_ON_SELLABLE_ROOMS,
          ...(exclude_reservation_room_id
            ? { reservation_room_id: { not: exclude_reservation_room_id } }
            : {}),
          night_date: {
            gte: dateOnlyToDb(arrival_date),
            lt: dateOnlyToDb(departure_date),
          },
        },
        _count: { _all: true },
      }),
      this.holdsByType(
        [unit_type_id],
        nights,
        client,
        buyer_customer_id,
        exclude_reservation_room_id,
      ),
      this.blockedByType([unit_type_id], nights, client),
    ]);
    const overbooking_allowance = Math.max(0, type?.overbooking_allowance ?? 0);
    const soldOn = countByNight(booked);
    const held = holds.get(unit_type_id) ?? nights.map(() => 0);
    const blocked = blocks.get(unit_type_id) ?? nights.map(() => 0);
    const taken = nights.map(
      (night, i) => (soldOn.get(night) ?? 0) + held[i] + blocked[i],
    );
    return {
      units,
      overbooking_allowance,
      sold: Math.max(0, ...soldOn.values()),
      held: Math.max(0, ...held),
      blocked: Math.max(0, ...blocked),
      available: Math.max(
        0,
        units + overbooking_allowance - Math.max(0, ...taken),
      ),
    };
  }

  /**
   * H2.5 — rooms an allotment of `customer_id` can hold on each night: the
   * sellable rooms minus nights sold and other customers' holds, plus the
   * nights this customer already booked (they count inside its allotment).
   * Returns the tightest night, so the form can say "quedan 2 el 20-dic".
   */
  async allotmentCapacity(
    unit_type_id: number,
    nights: string[],
    customer_id: number,
    client: LodgingInventoryClient = this.prisma,
  ): Promise<{ night: string; free: number }> {
    const range = {
      gte: dateOnlyToDb(nights[0]),
      lte: dateOnlyToDb(nights[nights.length - 1]),
    };
    const [type, units, booked, own, holds, blocks] = await Promise.all([
      client.lodging_unit_types.findFirst({
        where: { id: unit_type_id },
        select: { overbooking_allowance: true },
      }),
      client.lodging_units.count({ where: sellableUnitsWhere(unit_type_id) }),
      client.lodging_room_nights.groupBy({
        by: ['night_date'],
        where: { unit_type_id, is_active: true, night_date: range, ...NIGHTS_ON_SELLABLE_ROOMS },
        _count: { _all: true },
      }),
      client.lodging_room_nights.groupBy({
        by: ['night_date'],
        where: {
          unit_type_id,
          is_active: true,
          night_date: range,
          ...NIGHTS_ON_SELLABLE_ROOMS,
          reservation_room: { reservation: { customer_id } },
        },
        _count: { _all: true },
      }),
      this.holdsByType([unit_type_id], nights, client, customer_id),
      this.blockedByType([unit_type_id], nights, client),
    ]);
    const sellable = units + Math.max(0, type?.overbooking_allowance ?? 0);
    const soldOn = countByNight(booked);
    const ownOn = countByNight(own);
    const held = holds.get(unit_type_id) ?? nights.map(() => 0);
    const blocked = blocks.get(unit_type_id) ?? nights.map(() => 0);
    return nights
      .map((night, i) => ({
        night,
        free:
          sellable -
          (soldOn.get(night) ?? 0) -
          held[i] -
          blocked[i] +
          (ownOn.get(night) ?? 0),
      }))
      .reduce((tightest, n) => (n.free < tightest.free ? n : tightest));
  }

  /**
   * H5.3 — sellable rooms blocked per night (maintenance, owner use), by room
   * type (types without a block in range are absent). Only active blocks of
   * rooms still counted as sellable: a room already out of service is not
   * subtracted twice. `nights` are consecutive `YYYY-MM-DD`; a block covers
   * `[from_date, to_date)`. Room types are store-owned ids, so the filter stays
   * inside the store even with an unscoped transaction client.
   */
  async blockedByType(
    unit_type_ids: number[],
    nights: string[],
    client: LodgingInventoryClient = this.prisma,
  ): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    if (unit_type_ids.length === 0 || nights.length === 0) return result;
    const blocks = await client.lodging_inventory_blocks.findMany({
      where: {
        released_at: null,
        from_date: { lte: dateOnlyToDb(nights[nights.length - 1]) },
        to_date: { gt: dateOnlyToDb(nights[0]) },
        unit: {
          unit_type_id: { in: unit_type_ids },
          is_active: true,
          housekeeping_status: { notIn: [...UNSELLABLE_HOUSEKEEPING_STATUSES] },
        },
      },
      select: {
        unit_id: true,
        from_date: true,
        to_date: true,
        unit: { select: { unit_type_id: true } },
      },
    });
    // A room blocked twice on a night (maintenance + iCal, H6.2) counts once.
    const counted = new Set<string>();
    for (const block of blocks) {
      const typeId = block.unit.unit_type_id;
      const perNight = result.get(typeId) ?? nights.map(() => 0);
      const from = toDateOnly(block.from_date);
      const to = toDateOnly(block.to_date);
      nights.forEach((night, i) => {
        const key = `${block.unit_id}:${night}`;
        if (night >= from && night < to && !counted.has(key)) {
          counted.add(key);
          perNight[i] += 1;
        }
      });
      result.set(typeId, perNight);
    }
    return result;
  }

  /**
   * H2.5 — rooms held per night for allotments, by room type (types without
   * an allotment in range are absent). `nights` are consecutive `YYYY-MM-DD`.
   * Room types are store-owned ids, so the filters stay inside the store even
   * with an unscoped transaction client.
   */
  async holdsByType(
    unit_type_ids: number[],
    nights: string[],
    client: LodgingInventoryClient = this.prisma,
    buyer_customer_id?: number,
    exclude_reservation_room_id?: number,
  ): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    if (unit_type_ids.length === 0 || nights.length === 0) return result;
    const first = dateOnlyToDb(nights[0]);
    const last = dateOnlyToDb(nights[nights.length - 1]);
    const allotments = await client.lodging_allotments.findMany({
      where: {
        unit_type_id: { in: unit_type_ids },
        is_active: true,
        from_date: { lte: last },
        to_date: { gte: first },
        ...(buyer_customer_id
          ? { customer_id: { not: buyer_customer_id } }
          : {}),
      },
      select: {
        store_id: true,
        customer_id: true,
        unit_type_id: true,
        from_date: true,
        to_date: true,
        rooms: true,
        release_days: true,
      },
    });
    if (allotments.length === 0) return result;

    const customers = [...new Set(allotments.map((a) => a.customer_id))];
    const [timezone, booked] = await Promise.all([
      resolveStoreTimezone(this.prisma, allotments[0].store_id),
      client.lodging_room_nights.findMany({
        where: {
          unit_type_id: { in: unit_type_ids },
          is_active: true,
          night_date: { gte: first, lte: last },
          ...(exclude_reservation_room_id
            ? { reservation_room_id: { not: exclude_reservation_room_id } }
            : {}),
          reservation_room: { reservation: { customer_id: { in: customers } } },
        },
        select: {
          unit_type_id: true,
          night_date: true,
          reservation_room: {
            select: { reservation: { select: { customer_id: true } } },
          },
        },
      }),
    ]);
    const today = localDateString(new Date(), timezone);

    for (const unit_type_id of new Set<number>(
      allotments.map((a) => a.unit_type_id),
    )) {
      const consumed = new Map<string, number>();
      for (const n of booked) {
        if (n.unit_type_id !== unit_type_id) continue;
        const key = consumedKey(
          n.reservation_room.reservation.customer_id,
          toDateOnly(n.night_date),
        );
        consumed.set(key, (consumed.get(key) ?? 0) + 1);
      }
      result.set(
        unit_type_id,
        allotmentHolds({
          nights,
          allotments: allotments
            .filter((a) => a.unit_type_id === unit_type_id)
            .map((a) => ({
              customer_id: a.customer_id,
              from_date: toDateOnly(a.from_date),
              to_date: toDateOnly(a.to_date),
              rooms: a.rooms,
              release_days: a.release_days,
            })),
          consumed,
          today,
        }),
      );
    }
    return result;
  }
}

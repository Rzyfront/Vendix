import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb } from './stay-dates';

/** Prisma client or interactive transaction exposing the lodging models. */
export type LodgingInventoryClient = Pick<
  StorePrismaService,
  'lodging_unit_types' | 'lodging_units' | 'lodging_room_nights'
>;

/** Inventory of a room type over a stay. */
export interface LodgingTypeInventory {
  /** Active physical rooms of the type. */
  units: number;
  /** Rooms the hotel may sell above `units` (H1.6 overbooking). */
  overbooking_allowance: number;
  /** Most rooms already sold on any night of the stay. */
  sold: number;
  /** Rooms still for sale: `units + overbooking_allowance - sold`, never below 0. */
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
  ): Promise<number> {
    const inventory = await this.getInventory(
      unit_type_id,
      arrival_date,
      departure_date,
      client,
      exclude_reservation_room_id,
    );
    return inventory.available;
  }

  async getInventory(
    unit_type_id: number,
    arrival_date: string,
    departure_date: string,
    client: LodgingInventoryClient = this.prisma,
    exclude_reservation_room_id?: number,
  ): Promise<LodgingTypeInventory> {
    const [type, units, booked] = await Promise.all([
      client.lodging_unit_types.findFirst({
        where: { id: unit_type_id },
        select: { overbooking_allowance: true },
      }),
      client.lodging_units.count({ where: { unit_type_id, is_active: true } }),
      client.lodging_room_nights.groupBy({
        by: ['night_date'],
        where: {
          unit_type_id,
          is_active: true,
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
    ]);
    const overbooking_allowance = Math.max(0, type?.overbooking_allowance ?? 0);
    const sold = booked.reduce((max, n) => Math.max(max, n._count._all), 0);
    return {
      units,
      overbooking_allowance,
      sold,
      available: Math.max(0, units + overbooking_allowance - sold),
    };
  }
}

import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb } from './stay-dates';

/** Prisma client or interactive transaction exposing the lodging models. */
export type LodgingInventoryClient = Pick<
  StorePrismaService,
  'lodging_units' | 'lodging_room_nights'
>;

/**
 * Hospitality Suite (H1.1) — room-type availability per night.
 *
 * Rooms of a type left for a stay = active rooms - the most active nights
 * already sold on any night of the stay. Pass the transaction client when the
 * count guards a sale, so it runs under the same lock as the insert.
 */
@Injectable()
export class LodgingAvailabilityService {
  constructor(private readonly prisma: StorePrismaService) {}

  async countAvailable(
    unit_type_id: number,
    arrival_date: string,
    departure_date: string,
    client: LodgingInventoryClient = this.prisma,
  ): Promise<number> {
    const [units, booked] = await Promise.all([
      client.lodging_units.count({ where: { unit_type_id, is_active: true } }),
      client.lodging_room_nights.groupBy({
        by: ['night_date'],
        where: {
          unit_type_id,
          is_active: true,
          night_date: {
            gte: dateOnlyToDb(arrival_date),
            lt: dateOnlyToDb(departure_date),
          },
        },
        _count: { _all: true },
      }),
    ]);
    const busiest = booked.reduce((max, n) => Math.max(max, n._count._all), 0);
    return Math.max(0, units - busiest);
  }
}

import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb } from '../stay-dates';
import { buildRack, Rack, RACK_STATUSES, rackNights } from './rack-builder';

/** Hospitality Suite (H1.3) — read model of the occupancy rack. */
@Injectable()
export class LodgingRackService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getRack(from: string, to: string): Promise<Rack> {
    rackNights(from, to);
    const range = { gte: dateOnlyToDb(from), lt: dateOnlyToDb(to) };

    const [rooms, sold] = await Promise.all([
      this.prisma.lodging_reservation_rooms.findMany({
        where: {
          arrival_date: { lt: dateOnlyToDb(to) },
          departure_date: { gt: dateOnlyToDb(from) },
          cancelled_at: null,
          reservation: { status: { in: RACK_STATUSES } },
        },
        select: {
          id: true,
          unit_type_id: true,
          unit_id: true,
          arrival_date: true,
          departure_date: true,
          reservation: {
            select: {
              id: true,
              reservation_number: true,
              status: true,
              customer: { select: { first_name: true, last_name: true } },
            },
          },
        },
      }),
      this.prisma.lodging_room_nights.groupBy({
        by: ['unit_type_id', 'night_date'],
        where: { is_active: true, night_date: range },
        _count: { _all: true },
      }),
    ]);

    // Active types and rooms, plus inactive ones that still hold a stay.
    const typeIds = [...new Set(rooms.map((r) => r.unit_type_id))];
    const unitIds = [...new Set(rooms.flatMap((r) => (r.unit_id ? [r.unit_id] : [])))];
    const [types, units] = await Promise.all([
      this.prisma.lodging_unit_types.findMany({
        where: { OR: [{ is_active: true }, { id: { in: typeIds } }] },
        select: { id: true, name: true, overbooking_allowance: true },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.lodging_units.findMany({
        where: { OR: [{ is_active: true }, { id: { in: unitIds } }] },
        select: {
          id: true,
          unit_type_id: true,
          code: true,
          floor: true,
          housekeeping_status: true,
          is_active: true,
        },
        orderBy: [{ code: 'asc' }],
      }),
    ]);

    return buildRack({
      from,
      to,
      types,
      units,
      rooms,
      sold: sold.map((s) => ({
        unit_type_id: s.unit_type_id,
        night_date: s.night_date,
        count: s._count._all,
      })),
    });
  }
}

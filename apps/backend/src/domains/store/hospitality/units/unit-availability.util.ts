import { Prisma } from '@prisma/client';
import { dateOnlyToDb } from '../reservations/stay-dates';

/** One unit id, or several (the units list filters many rooms at once). */
export type UnitIdFilter = number | { in: number[] };

/**
 * Night rows that make a physical room taken: active nights on any of the
 * stay's nights, other than the ones of the room being placed.
 */
export function occupiedNightsWhere(params: {
  store_id: number;
  unit_id: UnitIdFilter;
  nights: string[];
  exclude_reservation_room_id?: number;
}): Prisma.lodging_room_nightsWhereInput {
  return {
    store_id: params.store_id,
    unit_id: params.unit_id,
    is_active: true,
    ...(params.exclude_reservation_room_id !== undefined && {
      reservation_room_id: { not: params.exclude_reservation_room_id },
    }),
    night_date: { in: params.nights.map(dateOnlyToDb) },
  };
}

/**
 * H5.3 — blocks (maintenance, owner use) still in force that overlap the
 * stay `[arrival, departure)`.
 */
export function activeBlocksWhere(params: {
  store_id: number;
  unit_id: UnitIdFilter;
  arrival: string;
  departure: string;
}): Prisma.lodging_inventory_blocksWhereInput {
  return {
    store_id: params.store_id,
    unit_id: params.unit_id,
    released_at: null,
    from_date: { lt: dateOnlyToDb(params.departure) },
    to_date: { gt: dateOnlyToDb(params.arrival) },
  };
}

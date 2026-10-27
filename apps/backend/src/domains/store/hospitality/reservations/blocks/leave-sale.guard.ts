import { Prisma } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  type LodgingAvailabilityService,
  NIGHTS_ON_SELLABLE_ROOMS,
} from '../lodging-availability.service';
import { dateOnlyToDb, formatShortDate } from '../stay-dates';
import {
  isSellableHousekeeping,
  UNSELLABLE_HOUSEKEEPING_STATUSES,
} from '../../housekeeping/housekeeping-status';

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

/** Room about to leave the sale, as read inside the sale-lock transaction. */
export interface UnitLeavingSale {
  id: number;
  code: string;
  unit_type_id: number;
  is_active: boolean;
  housekeeping_status: string;
  unit_type: { name: string; overbooking_allowance: number };
}

/**
 * Hospitality Suite (H5.1/H5.3) — guards shared by every way a room leaves
 * the sale (a dated block, or "Fuera de servicio" from the board). Runs
 * inside the store's sale-lock transaction over the nights `from` (inclusive)
 * up to `to` (exclusive; open-ended when absent):
 * 1. a reservation assigned to the room on those nights is moved first;
 * 2. the type's sold nights must still fit the remaining sellable rooms
 *    (its unassigned reservations need a room each).
 * `action` completes the messages: "bloquearla", "sacarla de servicio".
 */
export async function assertUnitCanLeaveSale(
  tx: Prisma.TransactionClient,
  availability: Pick<LodgingAvailabilityService, 'blockedByType'>,
  store_id: number,
  unit: UnitLeavingSale,
  nights: { from: string; to?: string },
  action: { verb: string; noun: string },
): Promise<void> {
  const night_date = {
    gte: dateOnlyToDb(nights.from),
    ...(nights.to ? { lt: dateOnlyToDb(nights.to) } : {}),
  };

  const reserved = await tx.lodging_room_nights.findFirst({
    where: { store_id, unit_id: unit.id, is_active: true, night_date },
    select: {
      night_date: true,
      reservation_room: { select: { reservation: { select: { reservation_number: true } } } },
    },
    orderBy: { night_date: 'asc' },
  });
  if (reserved) {
    throw new VendixHttpException(
      ErrorCodes.LODGING_BLOCK_RESERVED_001,
      `La ${unit.code} tiene la reserva ${reserved.reservation_room.reservation.reservation_number} el ${formatShortDate(toDateOnly(reserved.night_date))}. Muévela antes de ${action.verb}.`,
    );
  }

  // A room already outside the sale frees no capacity it still had.
  if (!unit.is_active || !isSellableHousekeeping(unit.housekeeping_status)) return;

  const sold = await tx.lodging_room_nights.groupBy({
    by: ['night_date'],
    where: {
      store_id,
      unit_type_id: unit.unit_type_id,
      is_active: true,
      night_date,
      ...NIGHTS_ON_SELLABLE_ROOMS,
    },
    _count: { _all: true },
    orderBy: { night_date: 'asc' },
  });
  if (sold.length === 0) return;

  const soldNights = sold.map((s) => toDateOnly(s.night_date));
  const [sellableUnits, blocks, ownBlocks] = await Promise.all([
    tx.lodging_units.count({
      where: {
        store_id,
        unit_type_id: unit.unit_type_id,
        is_active: true,
        housekeeping_status: { notIn: [...UNSELLABLE_HOUSEKEEPING_STATUSES] },
      },
    }),
    availability.blockedByType([unit.unit_type_id], soldNights, tx),
    // Nights this room is already blocked are already out of the count.
    tx.lodging_inventory_blocks.findMany({
      where: {
        store_id,
        unit_id: unit.id,
        released_at: null,
        to_date: { gt: night_date.gte },
        ...(night_date.lt ? { from_date: { lt: night_date.lt } } : {}),
      },
      select: { from_date: true, to_date: true },
    }),
  ]);
  const blocked = blocks.get(unit.unit_type_id) ?? soldNights.map(() => 0);
  const ownBlocked = (night: string) =>
    ownBlocks.some((b) => night >= toDateOnly(b.from_date) && night < toDateOnly(b.to_date));
  const capacity = sellableUnits + Math.max(0, unit.unit_type.overbooking_allowance);
  const short = soldNights.find(
    (night, i) =>
      sold[i]._count._all + blocked[i] + (ownBlocked(night) ? 0 : 1) > capacity,
  );
  if (short) {
    throw new VendixHttpException(
      ErrorCodes.LODGING_BLOCK_OVERSOLD_001,
      `${action.noun} la ${unit.code} deja sin habitación a reservas de ${unit.unit_type.name} el ${formatShortDate(short)}. Asígnalas o muévelas antes.`,
    );
  }
}

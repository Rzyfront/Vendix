import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { mergeStoreSettingsWithDefaults } from '../../../settings/defaults/default-store-settings';
import { LodgingReservationsService } from '../reservations.service';
import { LodgingRoomChangesService } from '../room-changes.service';
import { canTransition } from '../reservation-status';
import { formatShortDate } from '../stay-dates';
import { CheckInDto } from './check-in.dto';
import { isSellableHousekeeping } from '../../housekeeping/housekeeping-status';

/** Order number of a folio: one per reservation, so unique per store. */
export function folioOrderNumber(reservation_number: string): string {
  return `F-${reservation_number}`;
}

/**
 * Hospitality Suite (H3.2) — check-in of an arrival: the reservation goes
 * "En casa", its rooms get their physical room and the guest folio opens.
 *
 * Opening the folio copies the `table_sessions` pattern
 * (`createOpenSessionInTx`): a `draft` POS order of the holder at $0 linked
 * 1:1 by `lodging_folios`. The status change is a conditional update, so a
 * double click opens one folio only and the second request gets the same
 * result.
 */
@Injectable()
export class LodgingCheckInService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly reservations: LodgingReservationsService,
    private readonly roomChanges: LodgingRoomChangesService,
  ) {}

  async checkIn(id: number, dto: CheckInDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const user_id = context?.user_id ?? null;

    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id },
      select: {
        id: true,
        status: true,
        arrival_date: true,
        customer_id: true,
        reservation_number: true,
        folio: { select: { id: true } },
        rooms: {
          where: { cancelled_at: null },
          select: {
            id: true,
            unit_type: { select: { name: true } },
            unit: { select: { id: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!reservation) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_FIND_001);
    }
    // Double click: the first request already checked in and opened the folio.
    if (reservation.status === 'checked_in' && reservation.folio) {
      return this.reservations.findOne(id);
    }
    if (!canTransition(reservation.status, 'checked_in')) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_RESERVATION_TRANSITION_001,
        'Solo se hace check-in de una reserva confirmada',
      );
    }

    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const arrival = reservation.arrival_date.toISOString().slice(0, 10);
    if (arrival > localDateString(new Date(), timezone)) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_CHECKIN_EARLY_001,
        `La llegada es el ${formatShortDate(arrival)}: no se puede hacer check-in antes`,
      );
    }

    const holders = await this.prisma.lodging_guests.count({
      where: { reservation_id: id, is_primary: true },
    });
    if (holders < 1) {
      throw new VendixHttpException(ErrorCodes.LODGING_CHECKIN_GUESTS_001);
    }

    // Physical room of each active room: the one picked now or the assigned one.
    const picked = new Map((dto.rooms ?? []).map((r) => [r.room_id, r.unit_id]));
    const targets = reservation.rooms.map((room) => ({
      room_id: room.id,
      current: room.unit?.id ?? null,
      unit_id: picked.get(room.id) ?? room.unit?.id ?? null,
      type_name: room.unit_type.name,
    }));
    const missing = targets.find((t) => t.unit_id === null);
    if (missing) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_CHECKIN_UNIT_001,
        `Asigna una habitación (${missing.type_name}) antes del check-in`,
      );
    }
    const units = await this.prisma.lodging_units.findMany({
      where: { id: { in: targets.map((t) => t.unit_id!) } },
      select: { id: true, code: true, is_active: true, housekeeping_status: true },
    });
    const unitById = new Map<number, (typeof units)[number]>(units.map((u) => [u.id, u]));
    for (const target of targets) {
      const unit = unitById.get(target.unit_id!);
      if (!unit) throw new VendixHttpException(ErrorCodes.LODGING_UNIT_FIND_001);
      if (!unit.is_active || !isSellableHousekeeping(unit.housekeeping_status)) {
        throw new VendixHttpException(
          ErrorCodes.LODGING_RESERVATION_ROOM_UNIT_001,
          `La ${unit.code} no está disponible`,
        );
      }
    }
    const dirty = units.filter((u) => u.housekeeping_status === 'dirty').map((u) => u.code);
    if (dirty.length > 0 && !dto.confirm_dirty) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_CHECKIN_DIRTY_001,
        `La ${dirty.join(', ')} está sucia. ¿Hacer check-in de todos modos?`,
        { dirty_units: dirty },
      );
    }

    // Rooms picked now are assigned with the rack's rules (availability, lock).
    for (const target of targets) {
      if (target.unit_id !== target.current) {
        await this.roomChanges.apply(target.room_id, { unit_id: target.unit_id! }).catch((error) => {
          // A concurrent click already assigned this same room: nothing to do.
          if (error?.errorCode !== ErrorCodes.LODGING_RESERVATION_ROOM_NOCHANGE_001.code) throw error;
        });
      }
    }

    const currency = await this.loadCurrency(store_id);
    const now = new Date();
    const checkedIn = await this.prisma.$transaction(async (tx) => {
      // Only one request moves it from confirmed: a double click finds 0 rows.
      const updated = await tx.lodging_reservations.updateMany({
        where: { id, status: 'confirmed' },
        data: { status: 'checked_in', updated_at: now },
      });
      if (updated.count !== 1) return false;
      const order = await tx.orders.create({
        data: {
          store_id,
          created_by_user_id: user_id,
          customer_id: reservation.customer_id,
          order_number: folioOrderNumber(reservation.reservation_number),
          state: 'draft',
          channel: 'pos',
          currency,
          subtotal_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          discount_amount: 0,
          grand_total: 0,
          total_paid: 0,
          remaining_balance: 0,
          internal_notes: `Folio de la reserva ${reservation.reservation_number}`,
          updated_at: now,
        },
      });
      await tx.lodging_folios.create({
        data: { store_id, reservation_id: id, order_id: order.id, opened_at: now },
      });
      await tx.lodging_reservation_events.create({
        data: {
          store_id,
          reservation_id: id,
          from_status: 'confirmed',
          to_status: 'checked_in',
          reason: null,
          user_id,
        },
      });
      return true;
    });

    const result = await this.reservations.findOne(id);
    if (!checkedIn && result.status !== 'checked_in') {
      throw new VendixHttpException(
        ErrorCodes.LODGING_RESERVATION_TRANSITION_001,
        'La reserva cambió de estado; recarga e inténtalo de nuevo',
      );
    }
    return result;
  }

  /** Currency of the folio order: the store's, as every POS order. */
  private async loadCurrency(store_id: number): Promise<string> {
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    return mergeStoreSettingsWithDefaults(row?.settings)?.general?.currency || 'COP';
  }
}

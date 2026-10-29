import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { DeliverKeyDto } from './key-handover.dto';

/** A key is handed to a guest already in house (after the check-in). */
const DELIVERABLE_STATUSES = ['checked_in'];

const STAFF_SELECT = { select: { first_name: true, last_name: true } } as const;

const KEY_SELECT = {
  id: true,
  reservation_id: true,
  reservation_room_id: true,
  key_label: true,
  guest_name: true,
  notes: true,
  delivered_at: true,
  returned_at: true,
  reservation_room: { select: { unit: { select: { code: true } } } },
  delivered_by: STAFF_SELECT,
  returned_by: STAFF_SELECT,
} satisfies Prisma.lodging_key_handoversSelect;

type KeyRow = Prisma.lodging_key_handoversGetPayload<{ select: typeof KEY_SELECT }>;

const staffName = (user: { first_name: string | null; last_name: string | null } | null) =>
  user ? [user.first_name, user.last_name].filter(Boolean).join(' ') || null : null;

/**
 * Hospitality Suite (H8.4, replaced by owner decision D12) — key and access
 * card log of a reservation: which key was handed to which guest, by whom and
 * when, and who received it back and when. A key is with one guest at a time
 * in the whole hotel (partial unique index on the open handovers).
 */
@Injectable()
export class LodgingKeyHandoversService {
  constructor(private readonly prisma: StorePrismaService) {}

  async findAll(reservationId: number) {
    await this.findReservation(reservationId);
    const rows = await this.prisma.lodging_key_handovers.findMany({
      where: { reservation_id: reservationId },
      select: KEY_SELECT,
      orderBy: [{ delivered_at: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => this.present(row));
  }

  async deliver(reservationId: number, dto: DeliverKeyDto) {
    const store_id = this.requireStoreId();
    const reservation = await this.findReservation(reservationId);
    if (!DELIVERABLE_STATUSES.includes(reservation.status)) {
      throw new VendixHttpException(ErrorCodes.LODGING_KEY_STATUS_001);
    }
    const reservation_room_id = this.resolveRoom(reservation.rooms, dto.reservation_room_id);
    await this.assertKeyFree(dto.key_label);
    try {
      const row = await this.prisma.lodging_key_handovers.create({
        data: {
          store_id,
          reservation_id: reservationId,
          reservation_room_id,
          key_label: dto.key_label,
          guest_name: dto.guest_name,
          notes: dto.notes || null,
          delivered_by_user_id: RequestContextService.getContext()?.user_id ?? null,
        },
        select: KEY_SELECT,
      });
      return this.present(row);
    } catch (error) {
      // Two desks handing the same key at once: the open-key index wins.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.LODGING_KEY_DUP_001);
      }
      throw error;
    }
  }

  async returnKey(reservationId: number, keyId: number) {
    const current = await this.prisma.lodging_key_handovers.findFirst({
      where: { id: keyId, reservation_id: reservationId },
      select: { id: true, returned_at: true },
    });
    if (!current) throw new VendixHttpException(ErrorCodes.LODGING_KEY_FIND_001);
    if (current.returned_at) throw new VendixHttpException(ErrorCodes.LODGING_KEY_RETURNED_001);
    const now = new Date();
    // Guarded on `returned_at: null` so a double click never rewrites who got it back.
    const { count } = await this.prisma.lodging_key_handovers.updateMany({
      where: { id: keyId, returned_at: null },
      data: {
        returned_at: now,
        returned_by_user_id: RequestContextService.getContext()?.user_id ?? null,
        updated_at: now,
      },
    });
    if (!count) throw new VendixHttpException(ErrorCodes.LODGING_KEY_RETURNED_001);
    const row = await this.prisma.lodging_key_handovers.findFirst({
      where: { id: keyId },
      select: KEY_SELECT,
    });
    return this.present(row!);
  }

  /** The same key (case-insensitive) cannot be with two guests at once. */
  private async assertKeyFree(keyLabel: string) {
    const open = await this.prisma.lodging_key_handovers.findFirst({
      where: { returned_at: null, key_label: { equals: keyLabel, mode: 'insensitive' } },
      select: {
        key_label: true,
        guest_name: true,
        reservation: { select: { reservation_number: true } },
      },
    });
    if (open) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_KEY_DUP_001,
        `La llave ${open.key_label} la tiene ${open.guest_name} (reserva ${open.reservation.reservation_number}): registra su devolución antes de entregarla de nuevo`,
      );
    }
  }

  /** The room given (an active one of the reservation) or its only active room. */
  private resolveRoom(
    rooms: { id: number; cancelled_at: Date | null }[],
    roomId: number | undefined,
  ): number | null {
    const active = rooms.filter((room) => !room.cancelled_at);
    if (roomId === undefined) return active.length === 1 ? active[0].id : null;
    if (!active.some((room) => room.id === roomId)) {
      throw new VendixHttpException(ErrorCodes.LODGING_KEY_ROOM_001);
    }
    return roomId;
  }

  private async findReservation(id: number) {
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id },
      select: {
        id: true,
        status: true,
        rooms: { select: { id: true, cancelled_at: true }, orderBy: { id: 'asc' } },
      },
    });
    if (!reservation) throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_FIND_001);
    return reservation;
  }

  private present(row: KeyRow) {
    const { reservation_room, delivered_by, returned_by, ...rest } = row;
    return {
      ...rest,
      room_code: reservation_room?.unit?.code ?? null,
      delivered_by_name: staffName(delivered_by),
      returned_by_name: staffName(returned_by),
    };
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }
}

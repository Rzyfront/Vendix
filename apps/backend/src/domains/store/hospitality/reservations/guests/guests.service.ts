import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb } from '../stay-dates';
import { LodgingGuestDto } from './guest.dto';
import {
  guestFieldErrors,
  reportsSire,
  resolveNationality,
  TRAVEL_PURPOSES,
} from './lodging-guest-rules';

/** Guests are registered while the stay is ahead or in progress. */
const REGISTRABLE_STATUSES = ['tentative', 'confirmed', 'checked_in'];

const GUEST_SELECT = {
  id: true,
  reservation_id: true,
  reservation_room_id: true,
  customer_id: true,
  is_primary: true,
  document_type: true,
  document_number: true,
  first_name: true,
  last_name: true,
  nationality_country_code: true,
  birth_date: true,
  residence_city: true,
  origin_city: true,
  travel_purpose: true,
  entry_permit_type: true,
  is_non_resident: true,
  data_consent_at: true,
} satisfies Prisma.lodging_guestsSelect;

type GuestRow = Prisma.lodging_guestsGetPayload<{ select: typeof GUEST_SELECT }>;

/**
 * Hospitality Suite (H3.1) — guest register of a reservation: the holder and
 * each companion with document, nationality and origin, by room, so the
 * hotel meets the TRA register and knows who sleeps in each room. Foreign
 * guests carry "Reporta SIRE". Every save records the data-notice consent.
 */
@Injectable()
export class LodgingGuestsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async findAll(reservationId: number) {
    await this.findReservation(reservationId);
    const rows = await this.prisma.lodging_guests.findMany({
      where: { reservation_id: reservationId },
      select: GUEST_SELECT,
      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.present(row));
  }

  async create(reservationId: number, dto: LodgingGuestDto) {
    const store_id = this.requireStoreId();
    const reservation = await this.findRegistrableReservation(reservationId);
    const data = await this.buildData(reservation, dto);
    const isFirst =
      (await this.prisma.lodging_guests.count({ where: { reservation_id: reservationId } })) === 0;
    const is_primary = dto.is_primary ?? isFirst;
    const row = await this.saveGuarded<GuestRow>(() =>
      this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (is_primary) await this.clearPrimary(tx, reservationId);
        return tx.lodging_guests.create({
          data: { ...data, store_id, reservation_id: reservationId, is_primary },
          select: GUEST_SELECT,
        });
      }),
    );
    return this.present(row);
  }

  async update(reservationId: number, guestId: number, dto: LodgingGuestDto) {
    const reservation = await this.findRegistrableReservation(reservationId);
    const current = await this.findGuest(reservationId, guestId);
    const data = await this.buildData(reservation, dto);
    const is_primary = dto.is_primary ?? current.is_primary;
    const row = await this.saveGuarded<GuestRow>(() =>
      this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (is_primary) await this.clearPrimary(tx, reservationId, guestId);
        return tx.lodging_guests.update({
          where: { id: guestId },
          data: { ...data, is_primary, updated_at: new Date() },
          select: GUEST_SELECT,
        });
      }),
    );
    return this.present(row);
  }

  /**
   * H8.1 — the guest's own online check-in: saves the party in one go, holder
   * first. A guest whose document is already registered is updated (the desk
   * may have typed it); desk-only fields (customer link, IVA exemption,
   * permit) are kept unless `updateExisting` is false (guest already in
   * house: only new companions are added). The first guest becomes the holder
   * when the reservation has none, linked to the reservation customer.
   */
  async registerParty(
    reservationId: number,
    guests: LodgingGuestDto[],
    holderCustomerId: number | null,
    { updateExisting = true }: { updateExisting?: boolean } = {},
  ) {
    const store_id = this.requireStoreId();
    const reservation = await this.findRegistrableReservation(reservationId);
    const missing = guests.flatMap((guest, index) =>
      guestFieldErrors(guest).map((error) => `Huésped ${index + 1}: ${error}`),
    );
    if (missing.length) {
      throw new VendixHttpException(ErrorCodes.LODGING_GUEST_FIELDS_001, missing.join('. '), {
        missing,
      });
    }
    const rows = await Promise.all(guests.map((guest) => this.buildData(reservation, guest)));
    return this.saveGuarded<number>(() =>
      this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Serializes concurrent submits so the party never gets two holders.
        await tx.$executeRaw`SELECT id FROM lodging_reservations WHERE id = ${reservationId} AND store_id = ${store_id} FOR UPDATE`;
        let hasHolder =
          (await tx.lodging_guests.count({
            where: { reservation_id: reservationId, is_primary: true },
          })) > 0;
        for (const { customer_id, entry_permit_type, is_non_resident, ...data } of rows) {
          const existing = await tx.lodging_guests.findFirst({
            where: {
              reservation_id: reservationId,
              document_type: data.document_type,
              document_number: { equals: data.document_number, mode: 'insensitive' },
            },
            select: { id: true },
          });
          if (existing) {
            if (!updateExisting) continue;
            await tx.lodging_guests.update({
              where: { id: existing.id },
              data: { ...data, updated_at: new Date() },
            });
            continue;
          }
          const is_primary = !hasHolder;
          hasHolder = true;
          await tx.lodging_guests.create({
            data: {
              ...data,
              store_id,
              reservation_id: reservationId,
              is_primary,
              customer_id: is_primary ? holderCustomerId : null,
              entry_permit_type,
              is_non_resident,
            },
          });
        }
        return rows.length;
      }),
    );
  }

  async remove(reservationId: number, guestId: number) {
    await this.findRegistrableReservation(reservationId);
    await this.findGuest(reservationId, guestId);
    await this.prisma.lodging_guests.delete({ where: { id: guestId } });
    return { id: guestId };
  }

  /** Validated row fields; throws the desk message of what is missing. */
  private async buildData(
    reservation: { id: number; rooms: { id: number; cancelled_at: Date | null }[] },
    dto: LodgingGuestDto,
  ) {
    const errors = guestFieldErrors(dto);
    if (errors.length) {
      throw new VendixHttpException(ErrorCodes.LODGING_GUEST_FIELDS_001, errors.join('. '), {
        missing: errors,
      });
    }
    const reservation_room_id = this.resolveRoom(reservation.rooms, dto.reservation_room_id);
    if (dto.customer_id) await this.assertStoreCustomer(dto.customer_id);
    return {
      reservation_room_id,
      customer_id: dto.customer_id ?? null,
      document_type: dto.document_type!,
      document_number: dto.document_number!,
      first_name: dto.first_name!,
      last_name: dto.last_name!,
      nationality_country_code: resolveNationality(dto)!,
      birth_date: dto.birth_date ? dateOnlyToDb(dto.birth_date) : null,
      residence_city: dto.residence_city!,
      origin_city: dto.origin_city!,
      travel_purpose: dto.travel_purpose!,
      entry_permit_type: dto.entry_permit_type || null,
      is_non_resident: dto.is_non_resident ?? false,
      data_consent_at: new Date(),
    };
  }

  /** The room given (an active one of the reservation) or its only active room. */
  private resolveRoom(
    rooms: { id: number; cancelled_at: Date | null }[],
    roomId: number | undefined,
  ): number {
    const active = rooms.filter((room) => !room.cancelled_at);
    if (roomId === undefined) {
      if (active.length === 1) return active[0].id;
      throw new VendixHttpException(ErrorCodes.LODGING_GUEST_ROOM_001);
    }
    if (!active.some((room) => room.id === roomId)) {
      throw new VendixHttpException(ErrorCodes.LODGING_GUEST_ROOM_001);
    }
    return roomId;
  }

  private async assertStoreCustomer(customerId: number) {
    const store_id = this.requireStoreId();
    const customer = await this.prisma.users.findFirst({
      where: { id: customerId, store_users: { some: { store_id } } },
      select: { id: true },
    });
    if (!customer) throw new VendixHttpException(ErrorCodes.LODGING_GUEST_CUSTOMER_001);
  }

  /** One holder per reservation: the new one replaces the previous. */
  private async clearPrimary(
    tx: Prisma.TransactionClient,
    reservationId: number,
    exceptId?: number,
  ) {
    await tx.lodging_guests.updateMany({
      where: {
        reservation_id: reservationId,
        is_primary: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { is_primary: false },
    });
  }

  private async saveGuarded<T>(save: () => Promise<unknown>): Promise<T> {
    try {
      return (await save()) as T;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.LODGING_GUEST_DUP_001);
      }
      throw error;
    }
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

  private async findRegistrableReservation(id: number) {
    const reservation = await this.findReservation(id);
    if (!REGISTRABLE_STATUSES.includes(reservation.status)) {
      throw new VendixHttpException(ErrorCodes.LODGING_GUEST_STATUS_001);
    }
    return reservation;
  }

  private async findGuest(reservationId: number, guestId: number) {
    const guest = await this.prisma.lodging_guests.findFirst({
      where: { id: guestId, reservation_id: reservationId },
      select: { id: true, is_primary: true },
    });
    if (!guest) throw new VendixHttpException(ErrorCodes.LODGING_GUEST_FIND_001);
    return guest;
  }

  private present(row: GuestRow) {
    return {
      ...row,
      birth_date: row.birth_date ? row.birth_date.toISOString().slice(0, 10) : null,
      travel_purpose_label: TRAVEL_PURPOSES[row.travel_purpose] ?? row.travel_purpose,
      reports_sire: reportsSire(row.nationality_country_code),
    };
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }
}

import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingGuestsService } from '../guests/guests.service';
import { PrecheckinSubmitDto } from './precheckin.dto';
import {
  newPrecheckinToken,
  PRECHECKIN_PATH,
  precheckinLinkOpen,
} from './precheckin-link';

const LINK_SELECT = {
  id: true,
  status: true,
  departure_date: true,
} as const;

/**
 * Hospitality Suite (H8.1) — online check-in: the desk shares a link and the
 * guest, without login, fills the TRA/SIRE data of the whole party before
 * arriving, so check-in at the desk takes a minute. The token is the only
 * capability; the store comes from the storefront host (scoped Prisma), so a
 * token never opens another hotel's reservation.
 */
@Injectable()
export class LodgingPrecheckinService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly guestsService: LodgingGuestsService,
  ) {}

  /** Desk: the reservation link (created on first use) on the store's online domain. */
  async getLink(reservationId: number) {
    const store_id = this.requireStoreId();
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id: reservationId },
      select: { ...LINK_SELECT, precheckin_token: true, precheckin_completed_at: true },
    });
    if (!reservation) throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_FIND_001);
    if (!precheckinLinkOpen(reservation, await this.storeToday(store_id))) {
      throw new VendixHttpException(ErrorCodes.LODGING_PRECHECKIN_EXPIRED_001);
    }
    return {
      url: await this.guestUrl(reservation, PRECHECKIN_PATH),
      completed_at: reservation.precheckin_completed_at,
    };
  }

  /**
   * The reservation's guest link on the store's online domain: `path` is the
   * storefront page (online check-in, H8.5 stay rating); the token is created
   * on first use and is the same for every guest page of the reservation.
   */
  async guestUrl(reservation: { id: number; precheckin_token: string | null }, path: string): Promise<string> {
    const store_id = this.requireStoreId();
    const domain = await this.prisma.domain_settings.findFirst({
      where: { store_id, domain_type: 'ecommerce', status: 'active', is_primary: true },
      orderBy: { updated_at: 'desc' },
      select: { hostname: true },
    });
    if (!domain) throw new VendixHttpException(ErrorCodes.LODGING_PRECHECKIN_DOMAIN_001);

    let token = reservation.precheckin_token;
    if (!token) {
      token = newPrecheckinToken();
      await this.prisma.lodging_reservations.update({
        where: { id: reservation.id },
        data: { precheckin_token: token, updated_at: new Date() },
      });
    }
    const base = /^https?:\/\//.test(domain.hostname) ? domain.hostname : `https://${domain.hostname}`;
    return `${base.replace(/\/+$/, '')}/${path}/${token}`;
  }

  /** Guest: what the form needs, with no personal data of the party. */
  async findByToken(token: string) {
    const reservation = await this.findOpenByToken(token);
    const [store, guests] = await Promise.all([
      this.prisma.stores.findFirst({
        where: { id: this.requireStoreId() },
        select: { name: true },
      }),
      this.prisma.lodging_guests.findMany({
        where: { reservation_id: reservation.id },
        select: { first_name: true, last_name: true, is_primary: true },
        orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
      }),
    ]);
    const rooms = reservation.rooms.filter((room) => !room.cancelled_at);
    return {
      store_name: store?.name ?? '',
      reservation_number: reservation.reservation_number,
      arrival_date: reservation.arrival_date.toISOString().slice(0, 10),
      departure_date: reservation.departure_date.toISOString().slice(0, 10),
      expected_guests: rooms.reduce((sum, room) => sum + room.adults + room.children, 0),
      rooms: rooms.map((room) => ({ id: room.id, name: room.unit_type.name })),
      // First name and initial only: the link must not reveal documents.
      registered: guests.map((guest) => ({
        name: `${guest.first_name} ${guest.last_name.charAt(0)}.`.trim(),
        is_primary: guest.is_primary,
      })),
      completed_at: reservation.precheckin_completed_at,
    };
  }

  /** Guest: saves the party and marks the online check-in complete. */
  async submit(token: string, dto: PrecheckinSubmitDto) {
    const reservation = await this.findOpenByToken(token);
    const saved = await this.guestsService.registerParty(
      reservation.id,
      dto.guests.map((guest) => ({ ...guest, data_consent: dto.data_consent })),
      reservation.customer_id,
    );
    const completed_at = new Date();
    await this.prisma.lodging_reservations.update({
      where: { id: reservation.id },
      data: { precheckin_completed_at: completed_at, updated_at: completed_at },
    });
    return { guests: saved, completed_at };
  }

  private async findOpenByToken(token: string) {
    const store_id = this.requireStoreId();
    const reservation = token
      ? await this.prisma.lodging_reservations.findFirst({
          where: { precheckin_token: token },
          select: {
            ...LINK_SELECT,
            reservation_number: true,
            arrival_date: true,
            customer_id: true,
            precheckin_completed_at: true,
            rooms: {
              select: {
                id: true,
                adults: true,
                children: true,
                cancelled_at: true,
                unit_type: { select: { name: true } },
              },
              orderBy: { id: 'asc' },
            },
          },
        })
      : null;
    if (!reservation) throw new VendixHttpException(ErrorCodes.LODGING_PRECHECKIN_FIND_001);
    if (!precheckinLinkOpen(reservation, await this.storeToday(store_id))) {
      throw new VendixHttpException(ErrorCodes.LODGING_PRECHECKIN_EXPIRED_001);
    }
    return reservation;
  }

  private async storeToday(store_id: number): Promise<string> {
    return localDateString(new Date(), await resolveStoreTimezone(this.prisma, store_id));
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }
}

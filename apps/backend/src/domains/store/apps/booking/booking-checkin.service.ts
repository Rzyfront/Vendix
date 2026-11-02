import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  localDateString,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { LodgingPrecheckinService } from '../../hospitality/reservations/precheckin/precheckin.service';
import {
  OnlineCheckinState,
  onlineCheckinPath,
  onlineCheckinState,
} from './booking-checkin';

export interface OnlineCheckinView {
  state: OnlineCheckinState;
  /** Relative path of the PMS check-in form; only when it can be opened. */
  path: string | null;
  completed_at: Date | null;
}

/**
 * Apps · booking (Fase 4): opens the PMS online check-in (H8.1) to the guest
 * who booked, from the booking page.
 *
 * The PMS already has the form and its rules; it only reaches the guest by a
 * link the desk shares or the reminder email. Here the logged-in customer
 * gets the same link for a reservation of theirs, built on the domain they
 * are on, once it is confirmed and while the PMS window is open. The token is
 * the PMS one (`ensureToken`), so desk, email and page share a single link.
 *
 * Tenant isolation: `StorePrismaService` scopes by the store resolved from
 * the hostname, and the reservation must belong to the customer.
 */
@Injectable()
export class BookingCheckinService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly precheckin: LodgingPrecheckinService,
  ) {}

  async forCustomer(
    reservationId: number,
    customerId: number,
  ): Promise<OnlineCheckinView> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);

    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id: reservationId, customer_id: customerId },
      select: {
        id: true,
        status: true,
        departure_date: true,
        precheckin_token: true,
        precheckin_completed_at: true,
      },
    });
    if (!reservation) {
      throw new VendixHttpException(ErrorCodes.LODGING_BOOKING_FIND_001);
    }

    const today = localDateString(
      new Date(),
      await resolveStoreTimezone(this.prisma, storeId),
    );
    const state = onlineCheckinState(reservation, today);
    if (state !== 'available' && state !== 'completed') {
      return { state, path: null, completed_at: reservation.precheckin_completed_at };
    }
    const token =
      reservation.precheckin_token ??
      (await this.precheckin.ensureToken(reservation.id));
    return {
      state,
      path: onlineCheckinPath(token),
      completed_at: reservation.precheckin_completed_at,
    };
  }
}

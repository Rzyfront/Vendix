import { Injectable, Logger } from '@nestjs/common';
import { booking_status_enum, Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import * as crypto from 'crypto';
import { AvailabilityService } from './availability.service';
import { ReservationsService } from './reservations.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';

/**
 * QUI-966 S9 — statuses an email link may change: confirm only a pending
 * booking, cancel a pending or confirmed one. Anything else (in service,
 * completed, cancelled, no-show) can no longer be changed from the email.
 */
const LINK_ALLOWED_FROM: Record<
  'confirm' | 'cancel',
  readonly booking_status_enum[]
> = {
  confirm: [booking_status_enum.pending],
  cancel: [booking_status_enum.pending, booking_status_enum.confirmed],
};

export interface BookingLinkResult {
  action: 'confirm' | 'cancel';
  booking_id: number;
  status: booking_status_enum;
  already_confirmed?: boolean;
  message: string;
}

@Injectable()
export class BookingConfirmationService {
  private readonly logger = new Logger(BookingConfirmationService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly availabilityService: AvailabilityService,
    private readonly reservationsService: ReservationsService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  async sendConfirmationRequest(
    bookingId: number,
    source: 'staff' | 'system' = 'staff',
  ) {
    const booking = await this.prisma.bookings.findUnique({
      where: { id: bookingId },
      include: { customer: true, product: true, provider: true },
    });
    if (!booking) throw new VendixHttpException(ErrorCodes.BOOK_CONFIRM_001);
    // QUI-966 S9: links only make sense while the booking can still change.
    if (!LINK_ALLOWED_FROM.cancel.includes(booking.status)) {
      throw new VendixHttpException(
        ErrorCodes.BOOK_CONFIRM_003,
        'Solo se puede pedir confirmación de reservas pendientes o confirmadas.',
      );
    }

    const confirmToken = crypto.randomBytes(32).toString('hex');
    const cancelToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    await this.prisma.booking_confirmation_tokens.createMany({
      data: [
        {
          booking_id: bookingId,
          store_id: booking.store_id,
          token: confirmToken,
          action: 'confirm',
          expires_at: expiresAt,
        },
        {
          booking_id: bookingId,
          store_id: booking.store_id,
          token: cancelToken,
          action: 'cancel',
          expires_at: expiresAt,
        },
      ],
    });

    await this.prisma.bookings.update({
      where: { id: bookingId },
      data: {
        confirmation_requested_at: new Date(),
        confirmation_deadline: expiresAt,
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('booking.confirmation_request', {
      store_id: booking.store_id,
      booking_id: bookingId,
      booking_number: booking.booking_number,
      customer_name: `${booking.customer?.first_name} ${booking.customer?.last_name}`,
      customer_email: booking.customer?.email,
      customer_phone: booking.customer?.phone,
      service_name: booking.product?.name,
      booking_date: booking.date,
      booking_time: booking.start_time,
      confirm_token: confirmToken,
      cancel_token: cancelToken,
      source,
    });

    this.logger.log(
      `Confirmation request sent for booking ${bookingId} via ${source}`,
    );
    return {
      confirm_token: confirmToken,
      cancel_token: cancelToken,
      expires_at: expiresAt,
      source,
    };
  }

  async processToken(token: string): Promise<BookingLinkResult> {
    const tokenRecord = await this.prisma
      .withoutScope()
      .booking_confirmation_tokens.findUnique({
        where: { token },
        include: {
          booking: { include: { customer: true, product: true } },
        },
      });

    if (!tokenRecord)
      throw new VendixHttpException(ErrorCodes.BOOK_CONFIRM_001);
    if (tokenRecord.used)
      throw new VendixHttpException(ErrorCodes.BOOK_CONFIRM_002);
    if (tokenRecord.expires_at < new Date())
      throw new VendixHttpException(ErrorCodes.BOOK_CONFIRM_001);

    const action = tokenRecord.action;
    if (action !== 'confirm' && action !== 'cancel')
      throw new VendixHttpException(ErrorCodes.BOOK_CONFIRM_001);

    const booking = tokenRecord.booking;
    const status = booking.status as booking_status_enum;

    // QUI-966 S9: confirming an already confirmed booking is an idempotent
    // success. The link is still consumed (with its sibling) so it can't be
    // replayed, but the booking and its events are left alone.
    if (action === 'confirm' && status === booking_status_enum.confirmed) {
      await this.prisma
        .withoutScope()
        .$transaction((tx: Prisma.TransactionClient) =>
          this.consumeLinkTokens(tx, tokenRecord),
        );
      return {
        action,
        booking_id: booking.id,
        status,
        already_confirmed: true,
        message: 'Tu reserva ya estaba confirmada.',
      };
    }

    const allowedFrom = LINK_ALLOWED_FROM[action];
    if (!allowedFrom.includes(status)) {
      // Rejected without effect: the token stays as it was.
      throw this.bookingNotChangeable(action);
    }

    const dateStr =
      booking.date instanceof Date
        ? booking.date.toISOString().split('T')[0]
        : String(booking.date).split('T')[0];
    const customerName = `${booking.customer?.first_name ?? ''} ${booking.customer?.last_name ?? ''}`.trim();
    const serviceName = booking.product?.name ?? 'Servicio';

    if (action === 'confirm') {
      // Double-validation: re-check the slot is still available before
      // confirming. The customer might have clicked the email link hours
      // after the booking was placed; meanwhile another customer could
      // have grabbed the slot through a different channel (walk-in, POS).
      //
      // Decision (per UX product call): accept anyway and alert the staff.
      // The customer already has the token; rejecting would be a worse
      // experience than flagging the conflict for the staff to resolve.
      let slotAvailable = true;
      try {
        slotAvailable = await this.availabilityService.isSlotAvailable(
          booking.product_id,
          dateStr,
          booking.start_time,
          booking.end_time,
          booking.provider_id ?? undefined,
          // T3 advisory C: the booking itself never conflicts with itself.
          booking.id,
        );
      } catch (err: any) {
        // Don't fail the confirmation on a transient availability check.
        // Log and assume-available so the customer isn't punished for our
        // infrastructure hiccup. Staff still gets the booking.confirmed event.
        this.logger.warn(
          `Double-validation skipped for booking ${booking.id}: ${err.message}`,
        );
        slotAvailable = true;
      }

      await this.applyLinkChange(tokenRecord, allowedFrom, 'confirmed');
      this.logger.log(`Booking ${booking.id} confirmed via token`);

      this.eventEmitter.emit('booking.confirmed', {
        store_id: booking.store_id,
        booking_id: booking.id,
        booking_number: booking.booking_number,
        product_id: booking.product_id,
        customer_id: booking.customer_id,
        customer_name: customerName,
        service_name: serviceName,
        date: dateStr,
        start_time: booking.start_time,
      });

      if (!slotAvailable) {
        this.logger.warn(
          `Doble booking detectado: booking ${booking.id} (${booking.booking_number}) confirmó pero slot ${dateStr} ${booking.start_time} ocupado`,
        );
        this.eventEmitter.emit('booking.double_booking', {
          store_id: booking.store_id,
          booking_id: booking.id,
          booking_number: booking.booking_number,
        });
      }
      return {
        action,
        booking_id: booking.id,
        status: booking_status_enum.confirmed,
        message: 'Tu reserva quedó confirmada.',
      };
    }

    await this.applyLinkChange(tokenRecord, allowedFrom, 'cancelled');
    this.logger.log(`Booking ${booking.id} cancelled via token`);

    // QUI-966 S9/S7: same effects as a staff cancel (order release +
    // `booking.cancelled`), run in the booking's store context because this
    // endpoint is public. The booking is already cancelled: a failure here
    // is logged, never surfaced to the customer.
    try {
      await this.storeContextRunner.runInStoreContext(booking.store_id, () =>
        this.reservationsService.completeLinkCancellation(booking.id),
      );
    } catch (err) {
      this.logger.error(
        `Post-cancel effects failed for booking ${booking.id} cancelled via token: ${(err as Error).message}`,
      );
    }

    return {
      action,
      booking_id: booking.id,
      status: booking_status_enum.cancelled,
      message: 'Tu reserva fue cancelada.',
    };
  }

  /**
   * QUI-966 S9 — consumes the link and changes the booking in ONE
   * transaction. The token is claimed with a conditional update first, so
   * of two concurrent clicks only one gets here; the booking update is
   * conditional on its current status, so a booking changed meanwhile (by
   * staff or by the sibling link) rolls the claim back without effect.
   */
  private async applyLinkChange(
    tokenRecord: { id: number; booking_id: number; action: string },
    allowedFrom: readonly booking_status_enum[],
    target: booking_status_enum,
  ): Promise<void> {
    await this.prisma
      .withoutScope()
      .$transaction(async (tx: Prisma.TransactionClient) => {
        await this.consumeLinkTokens(tx, tokenRecord);
        const changed = await tx.bookings.updateMany({
          where: { id: tokenRecord.booking_id, status: { in: [...allowedFrom] } },
          data: { status: target, updated_at: new Date() },
        });
        if (changed.count !== 1) {
          throw this.bookingNotChangeable(tokenRecord.action);
        }
      });
  }

  /**
   * Claims the token (`used: false` → `true`, count must be 1) and burns
   * every other unused link of the same booking, so using one link
   * invalidates its sibling (QUI-966 S9).
   */
  private async consumeLinkTokens(
    tx: Prisma.TransactionClient,
    tokenRecord: { id: number; booking_id: number },
  ): Promise<void> {
    const now = new Date();
    const claimed = await tx.booking_confirmation_tokens.updateMany({
      where: { id: tokenRecord.id, used: false, expires_at: { gt: now } },
      data: { used: true, used_at: now },
    });
    if (claimed.count !== 1) {
      throw new VendixHttpException(ErrorCodes.BOOK_CONFIRM_002);
    }
    await tx.booking_confirmation_tokens.updateMany({
      where: { booking_id: tokenRecord.booking_id, used: false },
      data: { used: true, used_at: now },
    });
  }

  private bookingNotChangeable(action: string): VendixHttpException {
    return new VendixHttpException(
      ErrorCodes.BOOK_CONFIRM_003,
      action === 'confirm'
        ? 'Esta reserva ya no se puede confirmar. Comunícate con la tienda si necesitas ayuda.'
        : 'Esta reserva ya no se puede cancelar desde este enlace. Comunícate con la tienda si necesitas ayuda.',
    );
  }
}

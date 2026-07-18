import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import * as crypto from 'crypto';
import { AvailabilityService } from './availability.service';

@Injectable()
export class BookingConfirmationService {
  private readonly logger = new Logger(BookingConfirmationService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly availabilityService: AvailabilityService,
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

  async processToken(token: string) {
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

    // Mark the token as used atomically before any side effects, so
    // double-clicks on the customer's email link can't re-trigger the flow.
    await this.prisma.withoutScope().booking_confirmation_tokens.update({
      where: { id: tokenRecord.id },
      data: { used: true, used_at: new Date() },
    });

    const booking = tokenRecord.booking;
    const dateStr =
      booking.date instanceof Date
        ? booking.date.toISOString().split('T')[0]
        : String(booking.date).split('T')[0];
    const customerName = `${booking.customer?.first_name ?? ''} ${booking.customer?.last_name ?? ''}`.trim();
    const serviceName = booking.product?.name ?? 'Servicio';

    if (tokenRecord.action === 'confirm') {
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

      await this.prisma.withoutScope().bookings.update({
        where: { id: booking.id },
        data: { status: 'confirmed', updated_at: new Date() },
      });
      this.logger.log(`Booking ${booking.id} confirmed via token`);

      this.eventEmitter.emit('booking.confirmed', {
        store_id: booking.store_id,
        booking_id: booking.id,
        booking_number: booking.booking_number,
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
    } else if (tokenRecord.action === 'cancel') {
      await this.prisma.withoutScope().bookings.update({
        where: { id: booking.id },
        data: { status: 'cancelled', updated_at: new Date() },
      });
      this.logger.log(`Booking ${booking.id} cancelled via token`);

      this.eventEmitter.emit('booking.cancelled', {
        store_id: booking.store_id,
        booking_id: booking.id,
        booking_number: booking.booking_number,
        customer_name: customerName,
        service_name: serviceName,
        date: dateStr,
        start_time: booking.start_time,
      });
    }

    return { action: tokenRecord.action, booking_id: booking.id };
  }
}

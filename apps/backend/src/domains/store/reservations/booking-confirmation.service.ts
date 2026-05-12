import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import * as crypto from 'crypto';

@Injectable()
export class BookingConfirmationService {
  private readonly logger = new Logger(BookingConfirmationService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async sendConfirmationRequest(bookingId: number) {
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
      service_name: booking.product?.name,
      booking_date: booking.date,
      booking_time: booking.start_time,
      confirm_token: confirmToken,
      cancel_token: cancelToken,
    });

    this.logger.log(`Confirmation request sent for booking ${bookingId}`);
    return { confirm_token: confirmToken, cancel_token: cancelToken };
  }

  async processToken(token: string) {
    const tokenRecord = await this.prisma
      .withoutScope()
      .booking_confirmation_tokens.findUnique({
        where: { token },
        include: { booking: true },
      });

    if (!tokenRecord)
      throw new VendixHttpException(ErrorCodes.BOOK_CONFIRM_001);
    if (tokenRecord.used)
      throw new VendixHttpException(ErrorCodes.BOOK_CONFIRM_002);
    if (tokenRecord.expires_at < new Date())
      throw new VendixHttpException(ErrorCodes.BOOK_CONFIRM_001);

    await this.prisma.withoutScope().booking_confirmation_tokens.update({
      where: { id: tokenRecord.id },
      data: { used: true, used_at: new Date() },
    });

    if (tokenRecord.action === 'confirm') {
      await this.prisma.withoutScope().bookings.update({
        where: { id: tokenRecord.booking_id },
        data: { status: 'confirmed', updated_at: new Date() },
      });
      this.logger.log(`Booking ${tokenRecord.booking_id} confirmed via token`);
    } else if (tokenRecord.action === 'cancel') {
      await this.prisma.withoutScope().bookings.update({
        where: { id: tokenRecord.booking_id },
        data: { status: 'cancelled', updated_at: new Date() },
      });
      this.logger.log(`Booking ${tokenRecord.booking_id} cancelled via token`);
    }

    return { action: tokenRecord.action, booking_id: tokenRecord.booking_id };
  }
}

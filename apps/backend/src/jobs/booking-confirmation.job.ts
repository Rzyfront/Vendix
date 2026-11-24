import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { releasePlanSeatsForBookingInTx } from '../domains/store/reservations/service-plans/service-plan-seats.util';

@Injectable()
export class BookingConfirmationJob {
  private readonly logger = new Logger(BookingConfirmationJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron('*/15 * * * *')
  async handleExpiredConfirmations() {
    const now = new Date();

    const expiredBookings = await this.prisma.bookings.findMany({
      where: {
        confirmation_requested_at: { not: null },
        confirmation_deadline: { lt: now },
        status: 'pending',
      },
      include: {
        store: { include: { store_settings: true } },
        customer: true,
        product: true,
      },
    });

    for (const booking of expiredBookings) {
      const settings = (booking.store?.store_settings?.settings as any)
        ?.reservations;
      if (!settings?.confirmation?.auto_cancel_if_unconfirmed) continue;

      // QUI-1060: the seats of a plan booking go back with the cancellation.
      await this.prisma.$transaction(async (tx) => {
        await releasePlanSeatsForBookingInTx(tx, booking.id);
        await tx.bookings.update({
          where: { id: booking.id },
          data: { status: 'cancelled', updated_at: new Date() },
        });
      });

      this.eventEmitter.emit('booking.auto_cancelled', {
        store_id: booking.store_id,
        booking_id: booking.id,
        booking_number: booking.booking_number,
        customer_name: `${booking.customer?.first_name} ${booking.customer?.last_name}`,
        service_name: booking.product?.name,
        reason: 'unconfirmed',
      });

      this.logger.log(`Auto-cancelled unconfirmed booking ${booking.id}`);
    }

    if (expiredBookings.length > 0) {
      this.logger.log(
        `Processed ${expiredBookings.length} expired confirmation(s)`,
      );
    }
  }
}

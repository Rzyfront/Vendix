import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BookingRemindersJob {
  private readonly logger = new Logger(BookingRemindersJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  // Run every hour to check for bookings that need reminders (24h before)
  @Cron('0 * * * *')
  async handleBookingReminders() {
    this.logger.log('Running booking reminders...');

    try {
      // Calculate the target time window: bookings 24h from now (±30min window)
      const now = new Date();
      const reminder_start = new Date(now.getTime() + 23.5 * 60 * 60 * 1000); // 23.5h from now
      const reminder_end = new Date(now.getTime() + 24.5 * 60 * 60 * 1000);   // 24.5h from now

      const target_date = reminder_start.toISOString().split('T')[0];

      // Find confirmed bookings for the target date
      const bookings = await this.prisma.bookings.findMany({
        where: {
          date: new Date(target_date),
          status: 'confirmed',
        },
        include: {
          customer: { select: { first_name: true, last_name: true } },
          product: { select: { name: true } },
        },
      });

      let sent_count = 0;

      for (const booking of bookings) {
        // Check if the booking start_time falls within the reminder window
        const booking_datetime = new Date(`${target_date}T${booking.start_time}:00`);
        if (booking_datetime >= reminder_start && booking_datetime <= reminder_end) {
          this.event_emitter.emit('booking.reminder', {
            store_id: booking.store_id,
            booking_id: booking.id,
            booking_number: booking.booking_number,
            customer_name: `${booking.customer?.first_name || ''} ${booking.customer?.last_name || ''}`.trim(),
            service_name: booking.product?.name || 'Servicio',
            date: target_date,
            start_time: booking.start_time,
          });

          sent_count++;
          this.logger.log(`Reminder sent for booking ${booking.booking_number}`);
        }
      }

      if (sent_count > 0) {
        this.logger.log(`Sent ${sent_count} booking reminders`);
      }
    } catch (error) {
      this.logger.error('Error in booking reminders job', error);
    }
  }
}

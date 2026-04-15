import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/** Maps time_before strings to milliseconds */
const TIME_BEFORE_MS: Record<string, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class BookingRemindersJob {
  private readonly logger = new Logger(BookingRemindersJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  // Run every 5 minutes to check for bookings that need reminders
  @Cron('*/5 * * * *')
  async handleBookingReminders() {
    this.logger.log('Running booking reminders...');

    try {
      // Get all stores with their settings
      const stores = await this.prisma.stores.findMany({
        where: { is_active: true },
        include: { store_settings: true },
      });

      let total_sent = 0;

      for (const store of stores) {
        const settings = (store.store_settings?.settings as any)?.reservations;
        const reminderRules = settings?.reminders;

        // If no custom settings, use default rules
        const rules = reminderRules && Array.isArray(reminderRules)
          ? reminderRules.filter((r: any) => r.enabled)
          : [
              { time_before: '24h', channels: ['email', 'push'], enabled: true },
              { time_before: '1h', channels: ['push'], enabled: true },
            ];

        for (const rule of rules) {
          const ms = TIME_BEFORE_MS[rule.time_before];
          if (!ms) {
            this.logger.warn(`Unknown time_before value: ${rule.time_before}`);
            continue;
          }

          // Calculate target window: ±2.5 minutes around the target time
          const now = new Date();
          const windowMs = 2.5 * 60 * 1000; // half of 5-minute cron interval
          const targetStart = new Date(now.getTime() + ms - windowMs);
          const targetEnd = new Date(now.getTime() + ms + windowMs);

          // Find confirmed bookings within the time window for this store
          const bookings = await this.prisma.bookings.findMany({
            where: {
              store_id: store.id,
              status: 'confirmed',
              date: {
                gte: new Date(targetStart.toISOString().split('T')[0]),
                lte: new Date(targetEnd.toISOString().split('T')[0]),
              },
            },
            include: {
              customer: { select: { first_name: true, last_name: true, email: true } },
              product: { select: { name: true } },
            },
          });

          for (const booking of bookings) {
            // Build the full booking datetime to check if it falls in the window
            const dateStr = booking.date instanceof Date
              ? booking.date.toISOString().split('T')[0]
              : String(booking.date).split('T')[0];
            const bookingDatetime = new Date(`${dateStr}T${booking.start_time}:00`);

            if (bookingDatetime < targetStart || bookingDatetime > targetEnd) {
              continue;
            }

            // Check deduplication via booking_reminder_logs
            const alreadySent = await this.prisma.booking_reminder_logs.findFirst({
              where: {
                booking_id: booking.id,
                reminder_key: rule.time_before,
              },
            });

            if (alreadySent) continue;

            // Log the reminder to prevent duplicates — one log per channel
            for (const ch of rule.channels) {
              await this.prisma.booking_reminder_logs.create({
                data: {
                  booking_id: booking.id,
                  store_id: store.id,
                  reminder_key: rule.time_before,
                  channel: ch,
                  sent_at: new Date(),
                },
              });
            }

            // Emit reminder event
            this.event_emitter.emit('booking.reminder', {
              store_id: store.id,
              booking_id: booking.id,
              booking_number: booking.booking_number,
              customer_name: `${booking.customer?.first_name || ''} ${booking.customer?.last_name || ''}`.trim(),
              customer_email: booking.customer?.email,
              service_name: booking.product?.name || 'Servicio',
              date: dateStr,
              start_time: booking.start_time,
              time_before: rule.time_before,
              channels: rule.channels,
            });

            total_sent++;
            this.logger.log(`Reminder (${rule.time_before}) sent for booking ${booking.booking_number}`);
          }
        }
      }

      if (total_sent > 0) {
        this.logger.log(`Sent ${total_sent} booking reminders`);
      }
    } catch (error) {
      this.logger.error('Error in booking reminders job', error);
    }
  }
}

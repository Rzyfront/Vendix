import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/** Default proximity minutes when store_settings has no override. */
const DEFAULT_PROXIMITY_MINUTES = [30, 15, 5];

/**
 * Converts a local date+time (e.g. "2026-07-19" + "08:00") to a UTC Date
 * using the given IANA timezone (e.g. "America/Bogota").
 *
 * Uses Intl.DateTimeFormat to resolve the UTC offset for the timezone at
 * that specific date (handles DST correctly).
 */
function localTimeToUTC(
  dateStr: string,
  timeStr: string,
  timezone: string,
): Date {
  // Parse components
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);

  // Build a formatter for the target timezone
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Create a reference UTC date from the local components
  // (treat the local time as if it were UTC to get a reference point)
  const refUTC = Date.UTC(year, month - 1, day, hours, minutes, 0);

  // Format the reference date in the target timezone to find the offset
  const parts = fmt.formatToParts(new Date(refUTC));
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

  // The timezone-local representation of our reference UTC instant
  const tzYear = get('year');
  const tzMonth = get('month');
  const tzDay = get('day');
  const tzHour = get('hour');
  const tzMinute = get('minute');

  // What the timezone "thinks" the UTC instant is
  const tzAsUTC = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0);

  // Offset = how much the timezone shifts from UTC
  const offsetMs = tzAsUTC - refUTC;

  // The actual UTC instant = local time - offset
  return new Date(refUTC - offsetMs);
}

/**
 * "Tu cita está por comenzar" notifications.
 *
 * Runs every minute and emits `appointment_upcoming` events for bookings
 * that fall into one of the configured proximity windows
 * (T-60m, T-30m, T-15m, T-5m by default). The dedup table is
 * `proximity_notification_log` (one row per booking + proximity + channel)
 * so the same notification is never sent twice. Scope: only bookings
 * in `confirmed` or `arriving` state (cancellations and no-shows are
 * excluded).
 */
@Injectable()
export class BookingProximityJob {
  private readonly logger = new Logger(BookingProximityJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  // Run every minute; the proximity window is narrow enough that this
  // is cheap (one indexed query per store per minute).
  @Cron('* * * * *')
  async handleBookingProximity() {
    let total_sent = 0;

    try {
      const stores = await this.prisma.stores.findMany({
        where: { is_active: true },
        include: { store_settings: true },
      });

      const now = new Date();

      for (const store of stores) {
        const settings = (store.store_settings?.settings as any)?.appointments;
        const customProximity: number[] = Array.isArray(
          settings?.proximity_minutes,
        )
          ? settings.proximity_minutes
          : DEFAULT_PROXIMITY_MINUTES;

        // Store timezone for converting local booking times to UTC
        const tz = (store as any).timezone || 'America/Bogota';

        for (const proximityMin of customProximity) {
          if (!Number.isFinite(proximityMin) || proximityMin <= 0) continue;

          // ±30s around the target minute (one half of the cron interval).
          const windowMs = 30 * 1000;
          const targetStart = new Date(
            now.getTime() + proximityMin * 60_000 - windowMs,
          );
          const targetEnd = new Date(
            now.getTime() + proximityMin * 60_000 + windowMs,
          );

          // Find confirmed/arriving bookings whose start time falls in the
          // window. We filter on the same-day date because `date` is
          // stored as DateTime in the schema and most bookings are local.
          const today = new Date();
          const startOfDay = new Date(
            today.toISOString().split('T')[0] + 'T00:00:00.000',
          );
          const endOfDay = new Date(
            today.toISOString().split('T')[0] + 'T23:59:59.999',
          );

          const bookings = await this.prisma.bookings.findMany({
            where: {
              store_id: store.id,
              status: { in: ['confirmed', 'arriving'] as any },
              date: { gte: startOfDay, lte: endOfDay },
            },
            include: {
              customer: {
                select: {
                  first_name: true,
                  last_name: true,
                  email: true,
                  phone: true,
                },
              },
              product: { select: { name: true } },
            },
          });

          for (const booking of bookings) {
            const dateStr =
              booking.date instanceof Date
                ? booking.date.toISOString().split('T')[0]
                : String(booking.date).split('T')[0];

            // Convert local booking time to UTC using the store's timezone
            const bookingDatetimeUTC = localTimeToUTC(
              dateStr,
              booking.start_time,
              tz,
            );

            if (
              bookingDatetimeUTC < targetStart ||
              bookingDatetimeUTC > targetEnd
            ) {
              continue;
            }

            // Dedup by (booking_id, proximity_minutes, channel).
            const alreadySent =
              await this.prisma.proximity_notification_log.findFirst({
                where: {
                  booking_id: booking.id,
                  proximity_minutes: proximityMin,
                  channel: 'in_app',
                },
              });
            if (alreadySent) continue;

            // Persist the dedup row (only one channel for proximity today;
            // the channel field is here for future multi-channel expansion).
            await this.prisma.proximity_notification_log.create({
              data: {
                booking_id: booking.id,
                proximity_minutes: proximityMin,
                channel: 'in_app',
                sent_at: new Date(),
              },
            });

            // Emit the appointment_upcoming domain event. The
            // notifications-events.listener turns this into a row in
            // `notifications` and a broadcast over SSE + Web Push.
            this.event_emitter.emit('appointment.upcoming', {
              store_id: store.id,
              booking_id: booking.id,
              booking_number: booking.booking_number,
              proximity_minutes: proximityMin,
              customer_name:
                `${booking.customer?.first_name || ''} ${booking.customer?.last_name || ''}`.trim(),
              customer_email: booking.customer?.email,
              customer_phone: booking.customer?.phone,
              service_name: booking.product?.name || 'Servicio',
              date: dateStr,
              start_time: booking.start_time,
            });

            total_sent++;
            this.logger.log(
              `Proximity (${proximityMin}m) sent for booking ${booking.booking_number}`,
            );
          }
        }
      }

      if (total_sent > 0) {
        this.logger.log(
          `Sent ${total_sent} booking proximity notifications`,
        );
      }
    } catch (e) {
      this.logger.error(
        `BookingProximityJob failed: ${(e as Error).message}`,
      );
    }
  }
}

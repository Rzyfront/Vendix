import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  dateOnlyString,
  localDateString,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '@common/utils/store-timezone.util';
import { isValidCivilDate } from '../booking-time.util';
import { NotificationsService } from '../../notifications/notifications.service';

/**
 * Smart queue for the reservations redesign.
 *
 * Ranks each booking in the "arrival queue" (the client arrived at
 * the venue and is waiting to be seen) by the absolute delta between
 * the booking's target time and the client's arrival time, with a
 * secondary sort by manual priority (lower = sooner). The result is a
 * stable ordering that the POS list, the today-reservations panel and
 * the queue-management view consume to show "who is up next".
 *
 * Two methods:
 *
 * - `computeQueueForStore` is a READ-ONLY ranking. Returns the live
 *   ordering without touching the `bookings.queue_position` column.
 *   Cheap; safe to call on every render.
 *
 * - `refreshAndBroadcastQueue` is a WRITE: persists `queue_position`
 *   on each booking (in a transaction, idempotent) and broadcasts an
 *   `appointment_queued` notification to the customer promoted to
 *   rank 0. More expensive — call only when something changed
 *   (e.g. on `booking.arrival_recorded` from ReservationsService.checkIn).
 *
 * Wired into the NotificationsEventsListener via `booking.arrival_recorded`,
 * so manual invocations are rarely needed.
 */
@Injectable()
export class AppointmentQueueService {
  private readonly logger = new Logger(AppointmentQueueService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Compute and return the live ranking for the given store on the given
   * calendar day of the STORE (QUI-966 S10; defaults to the store's today).
   * `bookings` has no `starts_at` column: the appointment start is
   * `date` + `start_time` read as wall-clock in the store timezone. The
   * score is `ABS(starts_at - arrival_at)` (ascending); `priority`
   * (ascending, lower = sooner) breaks ties, then `created_at` and `id`
   * (FIFO, stable). Only bookings in `arriving` or `attending` status that
   * already have an `arrival_at` participate.
   */
  async computeQueueForStore(
    storeId: number,
    isoDay?: string,
  ): Promise<Array<{
    booking_id: number;
    booking_number: string;
    customer_id: number;
    provider_id: number | null;
    starts_at: Date;
    target_time: Date;
    arrival_at: Date;
    score: number;
    priority: number;
  }>> {
    if (isoDay !== undefined && !isValidCivilDate(isoDay)) {
      throw new BadRequestException(
        'El día de la cola no es válido; usa el formato AAAA-MM-DD',
      );
    }
    const timezone = await resolveStoreTimezone(this.prisma, storeId);
    const day = isoDay ?? localDateString(new Date(), timezone);

    // `bookings.date` is `@db.Date` stored as UTC midnight of the civil day.
    const candidates = await this.prisma.bookings.findMany({
      where: {
        store_id: storeId,
        date: new Date(`${day}T00:00:00.000Z`),
        status: { in: ['arriving', 'attending'] as any },
        arrival_at: { not: null },
      },
      select: {
        id: true,
        booking_number: true,
        customer_id: true,
        provider_id: true,
        date: true,
        start_time: true,
        arrival_at: true,
        priority: true,
        created_at: true,
      },
    });

    if (candidates.length === 0) return [];

    const ranked = candidates.map((c) => {
      const starts_at = this.appointmentStart(c.date, c.start_time, timezone);
      return {
        booking_id: c.id,
        booking_number: c.booking_number,
        customer_id: c.customer_id,
        provider_id: c.provider_id ?? null,
        starts_at,
        target_time: starts_at,
        arrival_at: c.arrival_at!,
        score: Math.abs(starts_at.getTime() - c.arrival_at!.getTime()),
        priority: c.priority ?? 0,
        created_ms: c.created_at ? new Date(c.created_at).getTime() : 0,
      };
    });

    ranked.sort(
      (x, y) =>
        x.score - y.score ||
        x.priority - y.priority ||
        x.created_ms - y.created_ms ||
        x.booking_id - y.booking_id,
    );

    return ranked.map(({ created_ms: _created_ms, ...entry }) => entry);
  }

  /** `date` (UTC-midnight civil day) + `HH:mm` as a store wall-clock instant. */
  private appointmentStart(
    date: Date,
    start_time: string,
    timezone: string,
  ): Date {
    const [y, mo, d] = dateOnlyString(date).split('-').map(Number);
    const [h, mi] = start_time.split(':').map(Number);
    return zonedWallClockToUtc(y, mo, d, h, mi, 0, 0, timezone);
  }

  /**
   * Persist the computed position onto each booking's `queue_position`
   * column and broadcast the `appointment_queued` notification for
   * whoever moved to the top of the queue.
   */
  async refreshAndBroadcastQueue(
    storeId: number,
    isoDay?: string,
  ): Promise<{ updated: number; promoted: number | null }> {
    const ranked = await this.computeQueueForStore(storeId, isoDay);
    if (ranked.length === 0) return { updated: 0, promoted: null };

    // Persist positions. Use `updateMany` with composite-key detection is
    // not possible in a single call (Prisma requires unique fields), so
    // we use a transaction. For volume in scope (a few hundred per day
    // per store) this is acceptable.
    await this.prisma.$transaction(
      ranked.map((entry) =>
        this.prisma.bookings.update({
          where: { id: entry.booking_id },
          data: { queue_position: ranked.indexOf(entry) },
        }),
      ),
    );

    // Notify whoever is at the top (rank 0) with `appointment_queued`.
    const promoted = ranked[0];
    if (promoted) {
      try {
        await this.notifications.createAndBroadcast(
          storeId,
          'appointment_queued' as any,
          'Tu turno se acerca',
          'Estás en la posición 1 de la cola. Prepárate para tu cita.',
          {
            booking_id: promoted.booking_id,
            queue_position: 0,
            arrival_at: promoted.arrival_at,
          },
        );
      } catch (e) {
        this.logger.warn(
          `queue-notification failed for booking ${promoted.booking_id}: ${(e as Error).message}`,
        );
      }
    }

    return { updated: ranked.length, promoted: promoted?.booking_id ?? null };
  }
}

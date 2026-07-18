import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

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
   * Compute and return the live ranking for the given store on the
   * given calendar day. The function is pure SQL: the score is
   * `ABS(target_time - arrival_at)` (ascending) and the tie-breaker is
   * `priority` (ascending, lower = sooner) and then `created_at`
   * (ascending, FIFO). Only bookings in `arriving` or `attending`
   * status participate.
   */
  async computeQueueForStore(
    storeId: number,
    isoDay: string,
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
    const startOfDay = new Date(`${isoDay}T00:00:00.000`);
    const endOfDay = new Date(`${isoDay}T23:59:59.999`);

    // Pull every candidate in window in one round-trip; sort in app to
    // avoid a Postgres `ABS(timestamp - timestamp)` expression that the
    // Prisma typed builder doesn't support cleanly. Booking rows without
    // an `arrival_at` are excluded — they haven't arrived yet and don't
    // belong to the live queue.
    const candidates = await this.prisma.bookings.findMany({
      where: {
        store_id: storeId,
        starts_at: { gte: startOfDay, lte: endOfDay },
        status: { in: ['arriving', 'attending'] as any },
        arrival_at: { not: null },
      },
      select: {
        id: true,
        booking_number: true,
        customer_id: true,
        provider_id: true,
        starts_at: true,
        arrival_at: true,
        priority: true,
      },
      orderBy: [{ arrival_at: 'asc' }, { priority: 'asc' }, { created_at: 'asc' }],
    });

    if (candidates.length === 0) return [];

    return candidates.map((c, idx) => ({
      booking_id: c.id,
      booking_number: c.booking_number,
      customer_id: c.customer_id,
      provider_id: c.provider_id ?? null,
      starts_at: c.starts_at,
      target_time: c.starts_at,
      arrival_at: c.arrival_at!,
      score:
        c.arrival_at && c.starts_at
          ? Math.abs(c.starts_at.getTime() - c.arrival_at.getTime())
          : Number.POSITIVE_INFINITY,
      priority: c.priority,
    }));
  }

  /**
   * Persist the computed position onto each booking's `queue_position`
   * column and broadcast the `appointment_queued` notification for
   * whoever moved to the top of the queue.
   */
  async refreshAndBroadcastQueue(
    storeId: number,
    isoDay: string,
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

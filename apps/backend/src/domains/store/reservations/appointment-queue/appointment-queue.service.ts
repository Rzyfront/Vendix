import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { bookingInterval } from '@common/utils/schedule-window.util';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';

/** Fila del tablero de la pestaña Cola (agenda-unificada, 2026-11-24). */
export interface QueueBoardRow {
  booking_id: number;
  booking_number: string;
  customer_name: string;
  service_name: string | null;
  provider_name: string | null;
  status: 'confirmed' | 'arriving' | 'attending';
  checked_in: boolean;
  start_time: string;
  end_time: string;
  starts_at: Date;
  arrival_at: Date | null;
  /** Minutos hasta el inicio; negativo si la hora ya pasó. */
  minutes_to_start: number;
  priority: number;
}

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
   * Live ranking of the day: who is waiting, in call order.
   *
   * Score is `ABS(start - arrival_at)` (ascending); tie-breakers are `priority`
   * (lower = sooner) and `created_at` (FIFO). Only `arriving` bookings (checked
   * in, not being served yet) participate: `attending` is already inside, so it
   * must not hold a queue position nor receive the "you are next" notice.
   *
   * This is the single source of the order: `refreshAndBroadcastQueue` persists
   * positions from it and the Cola board lists `waiting` with it, so the
   * monitor and the notification can never disagree.
   *
   * Without `isoDay` it ranks today in the store timezone (never the UTC date,
   * which after 19:00 in Bogotá is already tomorrow).
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
    // `bookings` has no `starts_at`: the start is `date` (@db.Date) + `start_time`
    // (HH:mm, store wall clock). Filter by the calendar day and derive the instant.
    const timezone = await resolveStoreTimezone(this.prisma, storeId);
    const targetDay = (isoDay ?? localDateString(new Date(), timezone)).slice(0, 10);
    const day = new Date(`${targetDay}T00:00:00.000Z`);

    // Pull every candidate in window in one round-trip; sort in app to
    // avoid a Postgres `ABS(timestamp - timestamp)` expression that the
    // Prisma typed builder doesn't support cleanly. Booking rows without
    // an `arrival_at` are excluded — they haven't arrived yet and don't
    // belong to the live queue.
    const candidates = await this.prisma.bookings.findMany({
      where: {
        store_id: storeId,
        date: day,
        status: 'arriving' as any,
        arrival_at: { not: null },
      },
      select: {
        id: true,
        booking_number: true,
        customer_id: true,
        provider_id: true,
        date: true,
        end_date: true,
        start_time: true,
        end_time: true,
        arrival_at: true,
        priority: true,
        created_at: true,
      },
    });

    if (candidates.length === 0) return [];

    return candidates
      .map((c) => {
        // La consulta ya exige `arrival_at`, pero sin él no hay score: se omite
        // en vez de romper el tablero.
        if (!c.arrival_at) return null;
        const starts_at = bookingInterval(c, timezone).startAt;
        return {
          booking_id: c.id,
          booking_number: c.booking_number,
          customer_id: c.customer_id,
          provider_id: c.provider_id ?? null,
          starts_at,
          target_time: starts_at,
          arrival_at: c.arrival_at,
          score: Math.abs(starts_at.getTime() - c.arrival_at.getTime()),
          priority: c.priority ?? 0,
          created_at: c.created_at ?? new Date(0),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort(
        (a, b) =>
          a.score - b.score ||
          a.priority - b.priority ||
          a.created_at.getTime() - b.created_at.getTime(),
      )
      .map(({ created_at: _createdAt, ...entry }) => entry);
  }

  /** Fila del tablero tal como la arma `dayBoard`. */
  private boardRow(
    row: {
      id: number;
      booking_number: string;
      status: string;
      start_time: string;
      end_time: string;
      date: Date;
      end_date: Date | null;
      arrival_at: Date | null;
      priority: number | null;
      customer?: { first_name: string | null; last_name: string | null } | null;
      product?: { name: string } | null;
      provider?: {
        display_name: string | null;
        employee?: { first_name: string; last_name: string | null } | null;
        user?: { first_name: string | null; last_name: string | null } | null;
      } | null;
    },
    timezone: string,
    now: Date,
  ): QueueBoardRow {
    const startsAt = bookingInterval(row, timezone).startAt;
    const employee = row.provider?.employee;
    const user = row.provider?.user;
    const providerName =
      row.provider?.display_name ??
      (employee ? `${employee.first_name} ${employee.last_name ?? ''}`.trim() : null) ??
      (user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() : null) ??
      null;
    const customerName =
      `${row.customer?.first_name ?? ''} ${row.customer?.last_name ?? ''}`.trim() ||
      `Reserva #${row.booking_number}`;
    return {
      booking_id: row.id,
      booking_number: row.booking_number,
      customer_name: customerName,
      service_name: row.product?.name ?? null,
      provider_name: providerName,
      status: row.status as QueueBoardRow['status'],
      checked_in: row.arrival_at != null,
      start_time: row.start_time,
      end_time: row.end_time,
      starts_at: startsAt,
      arrival_at: row.arrival_at ?? null,
      minutes_to_start: Math.round((startsAt.getTime() - now.getTime()) / 60_000),
      priority: row.priority ?? 0,
    };
  }

  /**
   * Tablero del día para la pestaña Cola: todo lo que la recepción necesita ver
   * de un vistazo, sin tocar `queue_position` ni notificar a nadie.
   *
   * - `attending`: ya está en atención.
   * - `arriving`: hizo check-in y espera (orden de la cola viva, por cercanía a
   *   su hora, con la prioridad manual como desempate).
   * - `confirmed`: programación confirmada que todavía no empieza, por hora
   *   (las de hora ya pasada sin check-in se quedan para que se vean).
   *
   * La cola viva (`computeQueueForStore`) sigue siendo la única fuente para
   * persistir posiciones y avisar al siguiente; este tablero es solo lectura y
   * agrega lo que aún no ha llegado.
   */
  async dayBoard(
    storeId: number,
    isoDay?: string,
    now: Date = new Date(),
  ): Promise<{
    day: string;
    generated_at: Date;
    in_service: QueueBoardRow[];
    waiting: QueueBoardRow[];
    upcoming: QueueBoardRow[];
  }> {
    // El día por defecto es HOY en la zona de la tienda: con un `toISOString()`
    // (UTC) un tablero abierto a las 20:00 de Bogotá mostraba el día siguiente.
    const timezone = await resolveStoreTimezone(this.prisma, storeId);
    const targetDay = (isoDay ?? localDateString(now, timezone)).slice(0, 10);
    const day = new Date(`${targetDay}T00:00:00.000Z`);

    const rows = await this.prisma.bookings.findMany({
      where: {
        store_id: storeId,
        date: day,
        status: { in: ['confirmed', 'arriving', 'attending'] as any },
      },
      select: {
        id: true,
        booking_number: true,
        status: true,
        customer_id: true,
        provider_id: true,
        date: true,
        end_date: true,
        start_time: true,
        end_time: true,
        arrival_at: true,
        priority: true,
        customer: { select: { first_name: true, last_name: true } },
        product: { select: { name: true } },
        provider: {
          select: {
            display_name: true,
            employee: { select: { first_name: true, last_name: true } },
            user: { select: { first_name: true, last_name: true } },
          },
        },
      },
      orderBy: [{ start_time: 'asc' }, { priority: 'asc' }, { created_at: 'asc' }],
    });

    const board = rows.map((row) => this.boardRow(row, timezone, now));

    // El orden de `waiting` NO se recalcula aquí: se reusa la cola viva, que es
    // la que además persiste posiciones y avisa al siguiente. Así el monitor y
    // la notificación no pueden mostrar personas distintas.
    const ranking = await this.computeQueueForStore(storeId, targetDay);
    const rankOf = new Map(ranking.map((entry, index) => [entry.booking_id, index]));

    return {
      day: targetDay,
      generated_at: now,
      in_service: board.filter((r) => r.status === 'attending'),
      waiting: board
        .filter((r) => r.status === 'arriving')
        .sort(
          (a, b) =>
            (rankOf.get(a.booking_id) ?? Number.MAX_SAFE_INTEGER) -
            (rankOf.get(b.booking_id) ?? Number.MAX_SAFE_INTEGER),
        ),
      // Confirmadas que todavía no empiezan (status `confirmed` = no iniciada):
      // incluye las que ya pasaron de hora sin check-in, que es justo lo que la
      // recepción necesita ver para reaccionar.
      upcoming: board
        .filter((r) => r.status === 'confirmed')
        .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime()),
    };
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

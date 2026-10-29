import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { EmailService } from '../../../../../email/email.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingPrecheckinService } from '../precheckin/precheckin.service';
import { stayNights } from '../stay-dates';
import {
  GuestMessageKey,
  GuestMessageSettings,
  guestMessageEmail,
  guestMessageSettings,
  preArrivalDue,
} from './guest-messages-text';

const DAY_MS = 86_400_000;
/** A confirmation or check-out older than this is never emailed (no backlog after a pause). */
const RECENT_MS = 2 * DAY_MS;
const CHANNEL = 'email';

const RESERVATION_SELECT = {
  id: true,
  reservation_number: true,
  arrival_date: true,
  departure_date: true,
  precheckin_completed_at: true,
  customer: { select: { email: true, first_name: true } },
  store: { select: { name: true } },
  rooms: {
    where: { cancelled_at: null },
    select: { unit_type: { select: { name: true } } },
    orderBy: { id: 'asc' as const },
  },
} satisfies Prisma.lodging_reservationsSelect;

type Candidate = Prisma.lodging_reservationsGetPayload<{ select: typeof RESERVATION_SELECT }>;

const notSent = (key: GuestMessageKey) => ({
  guest_message_logs: { none: { message_key: key, channel: CHANNEL } },
});

/**
 * Hospitality Suite (H8.2) — emails the guest without desk work: the
 * confirmation of a reservation, a reminder with the online check-in link
 * `guest_email_pre_arrival_hours` before arrival and a thank-you after
 * check-out. Each one is on/off in Configuración → Hotelería.
 *
 * Idempotent: the `lodging_guest_message_logs` row is claimed (unique per
 * reservation, message and channel) before sending, so overlapping runs never
 * repeat an email; a failed send releases it for the next run. Web bookings
 * already get their paid confirmation from the booking engine and are skipped
 * here. Same shape as the bookings reminders job, one store context at a time.
 */
@Injectable()
export class LodgingGuestMessagesJob {
  private readonly logger = new Logger(LodgingGuestMessagesJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly email: EmailService,
    private readonly precheckin: LodgingPrecheckinService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(now: Date = new Date()): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    let total = 0;
    try {
      const recent = new Date(now.getTime() - RECENT_MS);
      // Cross-store discovery (8 days covers the longest reminder, 168 h); each store decides precisely.
      const stores = await this.prisma.withoutScope().lodging_reservations.findMany({
        where: {
          OR: [
            { status: 'confirmed', events: { some: { to_status: 'confirmed', created_at: { gte: recent } } } },
            {
              status: 'confirmed',
              arrival_date: { gte: new Date(now.getTime() - DAY_MS), lte: new Date(now.getTime() + 8 * DAY_MS) },
            },
            { status: 'checked_out', events: { some: { to_status: 'checked_out', created_at: { gte: recent } } } },
          ],
        },
        distinct: ['store_id'],
        select: { store_id: true },
      });
      for (const { store_id } of stores) {
        try {
          total += await this.storeContextRunner.runInStoreContext(store_id, () =>
            this.runStore(store_id, now),
          );
        } catch (err: unknown) {
          this.logger.error(
            `LodgingGuestMessagesJob store ${store_id} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (total > 0) this.logger.log(`LodgingGuestMessagesJob: ${total} guest email(s) sent`);
      return total;
    } finally {
      this.isRunning = false;
    }
  }

  private async runStore(store_id: number, now: Date): Promise<number> {
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    const settings = guestMessageSettings(
      (row?.settings as { hospitality?: Record<string, unknown> } | null)?.hospitality,
    );
    if (!settings.confirmation && !settings.pre_arrival && !settings.post_stay) return 0;

    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = new Date(`${localDateString(now, timezone)}T00:00:00.000Z`);
    const recent = new Date(now.getTime() - RECENT_MS);
    let sent = 0;

    if (settings.confirmation) {
      const rows = await this.prisma.lodging_reservations.findMany({
        where: {
          status: 'confirmed',
          arrival_date: { gte: today },
          online_payments: { none: {} },
          events: { some: { to_status: 'confirmed', created_at: { gte: recent } } },
          ...notSent('confirmation'),
        },
        select: RESERVATION_SELECT,
      });
      for (const r of rows) sent += await this.send(store_id, 'confirmation', r, settings);
    }

    if (settings.pre_arrival) {
      const horizon = new Date(today.getTime() + (Math.ceil(settings.pre_arrival_hours / 24) + 1) * DAY_MS);
      const rows = await this.prisma.lodging_reservations.findMany({
        where: {
          status: 'confirmed',
          arrival_date: { gte: today, lte: horizon },
          ...notSent('pre_arrival'),
        },
        select: RESERVATION_SELECT,
      });
      for (const r of rows) {
        const arrival = r.arrival_date.toISOString().slice(0, 10);
        if (!preArrivalDue(arrival, settings.check_in_time, settings.pre_arrival_hours, now, timezone)) continue;
        sent += await this.send(store_id, 'pre_arrival', r, settings);
      }
    }

    if (settings.post_stay) {
      const rows = await this.prisma.lodging_reservations.findMany({
        where: {
          status: 'checked_out',
          events: { some: { to_status: 'checked_out', created_at: { gte: recent } } },
          ...notSent('post_stay'),
        },
        select: RESERVATION_SELECT,
      });
      for (const r of rows) sent += await this.send(store_id, 'post_stay', r, settings);
    }
    return sent;
  }

  /** Claims the log row, sends, and releases the claim if the email did not go out. Never throws. */
  private async send(
    store_id: number,
    key: GuestMessageKey,
    reservation: Candidate,
    settings: GuestMessageSettings,
  ): Promise<number> {
    const to = reservation.customer.email?.trim();
    if (!to) return 0;
    let logId: number;
    try {
      const log = await this.prisma.lodging_guest_message_logs.create({
        data: { store_id, reservation_id: reservation.id, message_key: key, channel: CHANNEL },
        select: { id: true },
      });
      logId = log.id;
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 0;
      throw err;
    }

    try {
      const arrival = reservation.arrival_date.toISOString().slice(0, 10);
      const departure = reservation.departure_date.toISOString().slice(0, 10);
      const precheckin_done = !!reservation.precheckin_completed_at;
      const message = guestMessageEmail(key, {
        guest_name: reservation.customer.first_name?.trim() || 'Hola',
        store_name: reservation.store?.name ?? 'el hotel',
        reservation_number: reservation.reservation_number,
        arrival_date: arrival,
        departure_date: departure,
        nights: stayNights(arrival, departure).length,
        room_type: reservation.rooms.map((room) => room.unit_type.name).join(', '),
        check_in_time: settings.check_in_time,
        check_out_time: settings.check_out_time,
        precheckin_done,
        precheckin_url: key === 'pre_arrival' && !precheckin_done ? await this.precheckinUrl(reservation.id) : null,
      });
      const result = await this.email.sendEmail(to, message.subject, message.html, message.text);
      if (result.success) return 1;
      this.logger.error(`Guest ${key} email for reservation ${reservation.id} not sent: ${result.error}`);
    } catch (err: unknown) {
      this.logger.error(
        `Guest ${key} email for reservation ${reservation.id} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    await this.prisma.lodging_guest_message_logs.deleteMany({ where: { id: logId } }).catch(() => undefined);
    return 0;
  }

  /** The H8.1 link; without an online domain the reminder still goes out, without it. */
  private async precheckinUrl(reservation_id: number): Promise<string | null> {
    try {
      return (await this.precheckin.getLink(reservation_id)).url;
    } catch {
      return null;
    }
  }
}
